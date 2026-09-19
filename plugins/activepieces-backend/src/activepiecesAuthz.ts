import { BackstageCredentials, UserInfoService } from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { apJson, apListAll } from './activepiecesClient';
import { getKeycloakPerson } from './keycloakLookup';

export const ADMIN_GROUP_REF = 'group:default/backstage-admin';

/**
 * Only projects created through Backstage carry this externalId prefix
 * (`backstage:<username>/<slug>`). The plugin deliberately ignores every
 * other project (the auto-created PERSONAL ones, hand-made TEAM projects
 * like "Shared Flows") -- it neither lists nor modifies them, which keeps
 * the blast radius of the platform-wide API key small.
 */
export const EXTERNAL_ID_PREFIX = 'backstage:';

// Permission names as defined by Activepieces' own role model (the arrays
// carried by each project role). They are NOT copied per role here: the
// check below reads the caller's actual role permissions live.
export const PERM_WRITE_PROJECT = 'WRITE_PROJECT';
export const PERM_WRITE_PROJECT_MEMBER = 'WRITE_PROJECT_MEMBER';

export interface ApProject {
  id: string;
  displayName: string;
  externalId: string | null;
  type: 'PERSONAL' | 'TEAM';
  created: string;
}

export interface ApMember {
  id: string;
  user: { id: string; email: string; firstName?: string; lastName?: string };
  projectRole: { id: string; name: string; permissions: string[] };
}

export interface CallerInfo {
  entityRef: string;
  username: string;
  isAdmin: boolean;
}

interface MinimalActionContext {
  getInitiatorCredentials(): Promise<BackstageCredentials>;
}

interface ApUser {
  id: string;
  email: string;
}

export async function findUserByEmail(config: Config, email: string): Promise<ApUser | undefined> {
  const users = await apListAll<ApUser>(config, '/v1/users');
  return users.find(u => u.email.toLowerCase() === email.toLowerCase());
}

/** The Backstage username recorded in `backstage:<username>/<slug>`. */
export function ownerOf(project: Pick<ApProject, 'externalId'>): string | undefined {
  return project.externalId?.startsWith(EXTERNAL_ID_PREFIX)
    ? project.externalId.slice(EXTERNAL_ID_PREFIX.length).split('/')[0]
    : undefined;
}

/**
 * The creator of a project is made its Admin at creation, but Activepieces
 * only materialises that membership at the person's FIRST login (sign-up is
 * invitation-only and the account does not exist before). Until then there
 * is no member row to read a role from, so the project's recorded creator is
 * recognised as its owner.
 *
 * Deliberately narrow: it applies ONLY while the creator has no Activepieces
 * account at all. Once the account exists the live member row is the sole
 * authority again -- so someone who was later removed on purpose does not
 * regain rights through this path.
 */
export async function isPendingOwner(
  config: Config,
  caller: CallerInfo,
  project: Pick<ApProject, 'externalId'>,
  callerEmail: string,
): Promise<boolean> {
  if (ownerOf(project) !== caller.username) return false;
  return (await findUserByEmail(config, callerEmail)) === undefined;
}

export function usernameFromEntityRef(entityRef: string): string {
  return entityRef.split('/').pop() ?? entityRef;
}

export async function callerInfo(
  ctx: MinimalActionContext,
  userInfo: UserInfoService,
): Promise<CallerInfo> {
  const info = await userInfo.getUserInfo(await ctx.getInitiatorCredentials());
  return {
    entityRef: info.userEntityRef,
    username: usernameFromEntityRef(info.userEntityRef),
    isAdmin: info.ownershipEntityRefs.includes(ADMIN_GROUP_REF),
  };
}

export function isForbidden(e: Error): boolean {
  return e.message.startsWith('Forbidden');
}

export function isManaged(project: Pick<ApProject, 'externalId' | 'type'>): boolean {
  return project.type === 'TEAM' && !!project.externalId?.startsWith(EXTERNAL_ID_PREFIX);
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function buildExternalId(username: string, slug: string): string {
  return `${EXTERNAL_ID_PREFIX}${username}/${slug}`;
}

export function listMembers(config: Config, projectId: string): Promise<ApMember[]> {
  return apListAll<ApMember>(config, `/v1/project-members?projectId=${encodeURIComponent(projectId)}`);
}

export async function listManagedProjects(config: Config): Promise<ApProject[]> {
  const all = await apListAll<ApProject>(config, '/v1/projects');
  return all.filter(isManaged);
}

/**
 * The single authorization gate for everything that touches a project.
 * DENY BY DEFAULT: passes only for (a) a `backstage-admin` member, or
 * (b) a member of the project whose CURRENT Activepieces role includes
 * `permission`. Because the permission array is read live from
 * Activepieces, a promotion/demotion made directly in Activepieces is
 * honoured immediately, with no separate ownership table to drift.
 *
 * Non-managed projects and unknown ids are indistinguishable from "no
 * access" for non-admins, so the existence of other people's projects is
 * not leaked through error differences.
 */
export async function requireProjectPermission(
  config: Config,
  caller: CallerInfo,
  projectId: string,
  permission: string,
): Promise<ApProject> {
  const denied = new Error(
    `Forbidden: ${caller.entityRef} may not modify Activepieces project "${projectId}" ` +
      `(not a Backstage-managed project you hold ${permission} on). Only members whose role allows it, ` +
      `or a member of ${ADMIN_GROUP_REF}, can do this.`,
  );

  let project: ApProject;
  try {
    project = await apJson<ApProject>(config, `/v1/projects/${encodeURIComponent(projectId)}`);
  } catch (e) {
    if (caller.isAdmin) throw new Error(`Project "${projectId}" not found (${(e as Error).message})`);
    throw denied;
  }
  if (!isManaged(project)) throw denied;
  if (caller.isAdmin) return project;

  const { email } = await getKeycloakPerson(config, caller.username);
  const members = await listMembers(config, projectId);
  const mine = members.find(m => m.user.email.toLowerCase() === email.toLowerCase());
  if (mine) {
    if (mine.projectRole.permissions.includes(permission)) return project;
    throw denied;
  }
  if (await isPendingOwner(config, caller, project, email)) return project;
  throw denied;
}

/** Refuses an operation that would leave the project with nobody able to manage its members. */
export function assertNotLastMemberManager(members: ApMember[], target: ApMember, action: string): void {
  const managers = members.filter(m => m.projectRole.permissions.includes(PERM_WRITE_PROJECT_MEMBER));
  const targetIsManager = target.projectRole.permissions.includes(PERM_WRITE_PROJECT_MEMBER);
  if (targetIsManager && managers.length <= 1) {
    throw new Error(
      `Refusing to ${action}: ${target.user.email} is the only member who can manage this project's members. ` +
        `Promote someone else first.`,
    );
  }
}
