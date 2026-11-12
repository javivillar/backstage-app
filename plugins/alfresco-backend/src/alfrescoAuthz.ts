import { administersProduct, PORTAL_ADMIN_GROUPS, productAdminGroups } from '@internal/backstage-plugin-portal-access-common';
import { BackstageCredentials, UserInfoService } from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { alfrescoFetch } from './alfrescoClient';

/** The product these pages manage: its administrators (portal-access-common) see and change every object. */
export const COMPONENT = 'alfrescodms-oneke';
/** Who administers it, for the messages. */
export const ADMINS = [...PORTAL_ADMIN_GROUPS, ...productAdminGroups(COMPONENT)].join(' or ');

const SITE_ROLES = ['SiteManager', 'SiteCollaborator', 'SiteContributor', 'SiteConsumer'] as const;
export type SiteRole = (typeof SITE_ROLES)[number];

export function isSiteRole(value: string): value is SiteRole {
  return (SITE_ROLES as readonly string[]).includes(value);
}

interface MinimalActionContext {
  getInitiatorCredentials(): Promise<BackstageCredentials>;
}

export interface CallerInfo {
  entityRef: string;
  username: string;
  isAdmin: boolean;
}

function usernameFromEntityRef(entityRef: string): string {
  return entityRef.split('/').pop() ?? entityRef;
}

export async function callerInfo(
  ctx: MinimalActionContext,
  userInfo: UserInfoService,
): Promise<CallerInfo> {
  const credentials = await ctx.getInitiatorCredentials();
  const info = await userInfo.getUserInfo(credentials);
  return {
    entityRef: info.userEntityRef,
    username: usernameFromEntityRef(info.userEntityRef),
    isAdmin: administersProduct(COMPONENT, info.ownershipEntityRefs),
  };
}

/**
 * Live authorization check against Alfresco's own native per-site role —
 * deliberately NOT a Backstage-side ownership table (unlike
 * seaweedfs-backend's groups/policies), because Alfresco already exposes a
 * rich, authoritative per-site membership/role model via
 * `GET /sites/{siteId}/members/{personId}`. A native promotion/demotion
 * done directly in Share is honored immediately, with no risk of drifting
 * from a separately stored "owner" field.
 *
 * Throws `Forbidden: ...` unless the caller is a `backstage-admin` (the
 * same portal-wide override every other manager plugin uses) or is
 * currently `SiteManager` of the given site.
 */
export async function requireSiteManagerOrAdmin(
  config: Config,
  caller: CallerInfo,
  siteId: string,
): Promise<void> {
  if (caller.isAdmin) return;
  const res = await alfrescoFetch(config, `/sites/${encodeURIComponent(siteId)}/members/${encodeURIComponent(caller.username)}`);
  if (res.ok) {
    const body = (await res.json()) as { entry?: { role?: string } };
    if (body.entry?.role === 'SiteManager') return;
  }
  throw new Error(
    `Forbidden: ${caller.entityRef} may not modify Alfresco site "${siteId}" ` +
      `(not its SiteManager). Only the site's SiteManager(s) or a member of ${ADMINS} can edit or delete it.`,
  );
}
