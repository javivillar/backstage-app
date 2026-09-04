import { BackstageCredentials, UserInfoService } from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { findSupersetUserId, ownersFilterQuery, supersetAdminFetch } from './supersetClient';

export const ADMIN_GROUP_REF = 'group:default/backstage-admin';

interface MinimalActionContext {
  getInitiatorCredentials(): Promise<BackstageCredentials>;
}

export interface CallerInfo {
  entityRef: string;
  username: string;
  isAdmin: boolean;
}

// Backstage entity refs here are 'user:default/<username>', and that
// username is exactly the Superset (and Keycloak) username — verified live:
// ab_user.username == Keycloak preferred_username for every existing
// account. No separate identity mapping table needed.
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
    isAdmin: info.ownershipEntityRefs.includes(ADMIN_GROUP_REF),
  };
}

export async function callerSupersetOwnerId(
  config: Config,
  caller: CallerInfo,
): Promise<number> {
  const id = await findSupersetUserId(config, caller.username);
  if (id === undefined) {
    throw new Error(
      `No Superset account found for "${caller.username}" — they must have logged into ` +
        'Superset at least once (via SSO) before they can own Superset objects created from Backstage.',
    );
  }
  return id;
}

/**
 * Superset already tracks `owners` natively on Chart/Dashboard/Dataset/
 * Database (unlike Keycloak, which has no ownership concept at all — see
 * plugins/keycloak-backend's OWNER_ATTR). But Backstage talks to Superset
 * through one shared service account, not per-user SSO, so Superset's own
 * ownership-based visibility never sees the real caller — Backstage has to
 * enforce it itself, same philosophy as requireOwnerOrAdmin in
 * keycloak-backend, just checking Superset's native `owners` field instead
 * of a bolted-on attribute.
 */
export type SupersetResource = 'database' | 'dataset' | 'chart' | 'dashboard';

/**
 * List a Superset resource scoped to the caller's own objects, or
 * everything for a backstage-admin member — pushes the owner filter into
 * Superset's own Rison `q` query rather than fetching-all-and-filtering.
 */
export async function listSupersetObjects<T = Record<string, unknown>>(
  config: Config,
  resource: SupersetResource,
  caller: CallerInfo,
): Promise<T[]> {
  let query = '';
  if (!caller.isAdmin) {
    const ownerId = await callerSupersetOwnerId(config, caller);
    query = `?q=${ownersFilterQuery(ownerId)}`;
  }
  const res = await supersetAdminFetch(config, `/api/v1/${resource}/${query}`);
  if (!res.ok) {
    throw new Error(`Failed to list Superset ${resource}s: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { result: T[] };
  return body.result;
}

export function requireOwnerOrAdmin(
  caller: CallerInfo,
  owners: Array<{ username?: string }> | undefined,
): void {
  if (caller.isAdmin) return;
  if (owners?.some(o => o.username === caller.username)) return;
  throw new Error(
    `Forbidden: ${caller.entityRef} may not modify this Superset object ` +
      `(owners: ${owners?.map(o => o.username).join(', ') || 'none'}). Only an owner or a ` +
      `member of ${ADMIN_GROUP_REF} can edit or delete it.`,
  );
}
