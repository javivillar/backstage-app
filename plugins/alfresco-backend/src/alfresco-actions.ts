import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Config } from '@backstage/config';
import { BackstageCredentials, UserInfoService } from '@backstage/backend-plugin-api';
import { CatalogService } from '@backstage/plugin-catalog-node';
import { alfrescoFetch } from './alfrescoClient';
import { CallerInfo, callerInfo, isSiteRole, requireSiteManagerOrAdmin } from './alfrescoAuthz';

interface ActionOptions {
  config: Config;
  userInfo: UserInfoService;
  catalog: CatalogService;
}

function randomUnusedPassword(): string {
  // Alfresco Person.password is mandatory on create but never actually used
  // to log in with — real auth happens via identity-service/Keycloak SSO
  // (see INTEGRATION.md). A random value just satisfies the API contract.
  return `Unused-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function splitName(displayName: string | undefined, fallback: string): { firstName: string; lastName: string } {
  const name = (displayName ?? fallback).trim();
  const [firstName, ...rest] = name.split(/\s+/);
  return { firstName: firstName || fallback, lastName: rest.join(' ') || fallback };
}

/**
 * Ensures the calling identity has an Alfresco Person, WITHOUT requiring
 * them to have ever logged into Share first — sidesteps the JIT-only
 * limitation site-group-sync still has (see TODO.md case 3). Verified live
 * 2026-09-17: `POST /people` with an admin-provisioned id works cleanly and
 * the resulting Person is reused (not duplicated) on the user's own later
 * real login, since its `id` already matches identity-service's
 * preferred_username-based principal attribute.
 */
async function ensurePersonProvisioned(
  config: Config,
  catalog: CatalogService,
  credentials: BackstageCredentials,
  caller: CallerInfo,
): Promise<void> {
  const existing = await alfrescoFetch(config, `/people/${encodeURIComponent(caller.username)}`);
  if (existing.ok) return;

  const entity = await catalog.getEntityByRef(caller.entityRef, { credentials });
  const profile = (entity?.spec as { profile?: { email?: string; displayName?: string } } | undefined)?.profile;
  const { firstName, lastName } = splitName(profile?.displayName, caller.username);

  const createRes = await alfrescoFetch(config, '/people', {
    method: 'POST',
    body: JSON.stringify({
      id: caller.username,
      firstName,
      lastName,
      email: profile?.email ?? `${caller.username}@placeholder.invalid`,
      password: randomUnusedPassword(),
    }),
  });
  if (!createRes.ok && createRes.status !== 409) {
    throw new Error(`Failed to provision Alfresco Person for "${caller.username}": ${createRes.status} ${await createRes.text()}`);
  }
}

interface CreateSiteInput {
  id: string;
  title: string;
  description?: string;
  visibility?: 'PUBLIC' | 'MODERATED' | 'PRIVATE';
}

export function createAlfrescoSiteAction(options: ActionOptions) {
  const { config, userInfo, catalog } = options;
  return createTemplateAction<CreateSiteInput>({
    id: 'alfresco:create-site',
    schema: {
      input: {
        type: 'object',
        required: ['id', 'title'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          visibility: { type: 'string', enum: ['PUBLIC', 'MODERATED', 'PRIVATE'] },
        },
      },
      output: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          visibility: { type: 'string' },
        },
      },
    },
    async handler(ctx) {
      const credentials = await ctx.getInitiatorCredentials();
      const caller = await callerInfo(ctx, userInfo);
      await ensurePersonProvisioned(config, catalog, credentials, caller);

      const { id, title, description, visibility } = ctx.input;
      const createRes = await alfrescoFetch(config, '/sites', {
        method: 'POST',
        body: JSON.stringify({ id, title, description: description ?? '', visibility: visibility ?? 'PRIVATE' }),
      });
      if (!createRes.ok) {
        throw new Error(`Failed to create Alfresco site "${id}": ${createRes.status} ${await createRes.text()}`);
      }

      // The technical account is the caller of POST /sites, so IT lands as
      // SiteManager, not the real user — add the real caller explicitly,
      // then drop the technical account's own membership so ownership is
      // unambiguous (the technical account keeps repo-wide access anyway
      // via GROUP_ALFRESCO_ADMINISTRATORS, independent of site membership).
      const addRes = await alfrescoFetch(config, `/sites/${encodeURIComponent(id)}/members`, {
        method: 'POST',
        body: JSON.stringify({ role: 'SiteManager', id: caller.username }),
      });
      if (!addRes.ok) {
        throw new Error(`Created site "${id}" but failed to add ${caller.username} as SiteManager: ${addRes.status} ${await addRes.text()}`);
      }

      const techAccount = config.getConfig('alfrescoAdmin').getString('username');
      if (techAccount !== caller.username) {
        await alfrescoFetch(config, `/sites/${encodeURIComponent(id)}/members/${encodeURIComponent(techAccount)}`, { method: 'DELETE' });
      }

      ctx.output('id', id);
      ctx.output('title', title);
      ctx.output('visibility', visibility ?? 'PRIVATE');
    },
  });
}

interface DeleteSiteInput {
  id: string;
}

export function deleteAlfrescoSiteAction(options: ActionOptions) {
  const { config, userInfo } = options;
  return createTemplateAction<DeleteSiteInput>({
    id: 'alfresco:delete-site',
    schema: {
      input: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      await requireSiteManagerOrAdmin(config, caller, ctx.input.id);
      const res = await alfrescoFetch(config, `/sites/${encodeURIComponent(ctx.input.id)}`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`Failed to delete Alfresco site "${ctx.input.id}": ${res.status} ${await res.text()}`);
      }
    },
  });
}

export { isSiteRole };
