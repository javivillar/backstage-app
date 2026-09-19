import { Config } from '@backstage/config';
import { apFetch, apJson, apListAll } from './activepiecesClient';
import {
  ApMember,
  ApProject,
  CallerInfo,
  PERM_WRITE_PROJECT_MEMBER,
  assertNotLastMemberManager,
  buildExternalId,
  listMembers,
  slugify,
} from './activepiecesAuthz';
import { ensureAccessGroup, getKeycloakPerson } from './keycloakLookup';

export const DEFAULT_CREATOR_ROLE = 'Admin';

interface ApUser {
  id: string;
  email: string;
}

interface ApInvitation {
  id: string;
  status: 'PENDING' | 'ACCEPTED';
  link?: string;
}

interface ApRole {
  name: string;
  permissions: string[];
}

export async function listRoles(config: Config): Promise<ApRole[]> {
  return apListAll<ApRole>(config, '/v1/project-roles');
}

async function getRole(config: Config, role: string): Promise<ApRole> {
  const roles = await listRoles(config);
  const found = roles.find(r => r.name === role);
  if (!found) {
    throw new Error(`Unknown project role "${role}". Available roles: ${roles.map(r => r.name).join(', ')}`);
  }
  return found;
}

export async function findUserByEmail(config: Config, email: string): Promise<ApUser | undefined> {
  const users = await apListAll<ApUser>(config, '/v1/users');
  return users.find(u => u.email.toLowerCase() === email.toLowerCase());
}

/**
 * Makes `email` a member of `projectId` with `role`, whether or not they
 * already have an Activepieces account:
 *  - already a member      -> just change the role;
 *  - has an account        -> the invitation is auto-accepted (verified
 *                             live 2026-09-19), membership is immediate;
 *  - no account yet        -> the invitation comes back PENDING with a
 *                             link; we accept it with its own token so that
 *                             the invitation-only sign-up gate lets their
 *                             first Keycloak login through, and the
 *                             membership materialises at that first login.
 */
export async function addOrSetMember(
  config: Config,
  projectId: string,
  email: string,
  role: string,
): Promise<{ status: 'role-updated' | 'added' | 'invited-pending-first-login' }> {
  const roleDefinition = await getRole(config, role);

  const members = await listMembers(config, projectId);
  const existing = members.find(m => m.user.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    if (existing.projectRole.name !== role) {
      // A change that removes the member's ability to manage members must
      // not strip the project of its last member manager.
      if (!roleDefinition.permissions.includes(PERM_WRITE_PROJECT_MEMBER)) {
        assertNotLastMemberManager(members, existing, `change ${email}'s role to ${role}`);
      }
      await apJson(config, `/v1/project-members/${existing.id}`, { method: 'POST', body: JSON.stringify({ role }) });
    }
    return { status: 'role-updated' };
  }

  const invitation = await apJson<ApInvitation>(config, '/v1/user-invitations', {
    method: 'POST',
    body: JSON.stringify({ email, type: 'PROJECT', projectId, projectRole: role }),
  });
  if (invitation.status === 'ACCEPTED') return { status: 'added' };

  const token = invitation.link ? new URL(invitation.link).searchParams.get('token') : null;
  if (!token) throw new Error(`Invitation for ${email} is PENDING but carries no acceptance token`);
  await apJson(config, '/v1/user-invitations/accept', {
    method: 'POST',
    body: JSON.stringify({ invitationToken: token }),
  });
  return { status: 'invited-pending-first-login' };
}

/**
 * Creates the caller's project and makes them its Admin. The creator is not
 * recorded by Activepieces itself (a service-key call makes the PLATFORM
 * OWNER the project's ownerId), so ownership is encoded in the externalId
 * and, authoritatively, in the creator's Admin membership.
 */
export async function createManagedProject(
  config: Config,
  caller: CallerInfo,
  displayName: string,
): Promise<ApProject> {
  const slug = slugify(displayName);
  if (!slug) throw new Error('The project name must contain at least one letter or digit');
  const externalId = buildExternalId(caller.username, slug);

  // externalId is unique per platform; a duplicate would surface as a raw
  // Postgres 23505 / HTTP 500, so check first and answer clearly.
  const clash = await apJson<{ data: ApProject[] }>(config, `/v1/projects?externalId=${encodeURIComponent(externalId)}`);
  if (clash.data.length > 0) {
    throw new Error(`You already have an Activepieces project called "${slug}". Choose another name.`);
  }

  const person = await getKeycloakPerson(config, caller.username);
  await ensureAccessGroup(config, person);

  const project = await apJson<ApProject>(config, '/v1/projects', {
    method: 'POST',
    body: JSON.stringify({ displayName, externalId }),
  });
  try {
    await addOrSetMember(config, project.id, person.email, DEFAULT_CREATOR_ROLE);
  } catch (e) {
    // Never leave a project nobody owns behind.
    await apFetch(config, `/v1/projects/${project.id}`, { method: 'DELETE' });
    throw new Error(`Could not make ${caller.username} the Admin of the new project (project rolled back): ${(e as Error).message}`);
  }
  return project;
}

export async function removeMember(config: Config, projectId: string, memberId: string): Promise<ApMember> {
  const members = await listMembers(config, projectId);
  const target = members.find(m => m.id === memberId);
  if (!target) throw new Error(`Member "${memberId}" is not a member of project "${projectId}"`);
  assertNotLastMemberManager(members, target, `remove ${target.user.email}`);
  await apJson(config, `/v1/project-members/${memberId}`, { method: 'DELETE' });
  return target;
}
