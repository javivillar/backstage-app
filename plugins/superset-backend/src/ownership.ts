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
 * Superset's own Rison `q` query rather than fetching-all-and-filtering,
 * EXCEPT for `database`: verified live that Superset's DatabaseRestApi
 * rejects filtering on `owners` ("Filter column: owners not allowed to
 * filter", 400) even though chart/dataset/dashboard all accept the exact
 * same filter shape — an inconsistency in Superset itself, not something
 * fixable from the client side. Falls back to fetch-all + per-item detail
 * GET (owners isn't in the list response for ANY of these 4 resources,
 * verified live) + filter in Node. Fine at this scale (an internal dev
 * platform's own connection count, not customer data).
 */
export async function listSupersetObjects(
  config: Config,
  resource: SupersetResource,
  caller: CallerInfo,
): Promise<Record<string, unknown>[]> {
  if (caller.isAdmin) {
    const res = await supersetAdminFetch(config, `/api/v1/${resource}/`);
    if (!res.ok) {
      throw new Error(`Failed to list Superset ${resource}s: ${res.status} ${await res.text()}`);
    }
    return ((await res.json()) as { result: Record<string, unknown>[] }).result;
  }

  const ownerId = await callerSupersetOwnerId(config, caller);

  if (resource !== 'database') {
    const res = await supersetAdminFetch(config, `/api/v1/${resource}/?q=${ownersFilterQuery(ownerId)}`);
    if (!res.ok) {
      throw new Error(`Failed to list Superset ${resource}s: ${res.status} ${await res.text()}`);
    }
    return ((await res.json()) as { result: Record<string, unknown>[] }).result;
  }

  const res = await supersetAdminFetch(config, `/api/v1/${resource}/`);
  if (!res.ok) {
    throw new Error(`Failed to list Superset ${resource}s: ${res.status} ${await res.text()}`);
  }
  const all = ((await res.json()) as { result: Record<string, unknown>[] }).result;
  const owned = await Promise.all(
    all.map(async item => {
      const detail = await supersetAdminFetch(config, `/api/v1/${resource}/${item.id}`);
      if (!detail.ok) return undefined;
      const body = (await detail.json()) as { result: { owners?: Array<{ id?: number }> } };
      return body.result.owners?.some(o => o.id === ownerId) ? item : undefined;
    }),
  );
  return owned.filter((x): x is Record<string, unknown> => x !== undefined);
}

// Superset's single-object GET returns `owners` as { id, first_name,
// last_name } — NO `username` field (verified live) — so ownership has to
// be compared by numeric Superset user id, not username. Callers must
// already have resolved the caller's own Superset id (callerSupersetOwnerId)
// before calling this, since that itself requires an API round-trip.
export function requireOwnerOrAdmin(
  caller: CallerInfo,
  callerSupersetId: number,
  owners: Array<{ id?: number; first_name?: string; last_name?: string }> | undefined,
): void {
  if (caller.isAdmin) return;
  if (owners?.some(o => o.id === callerSupersetId)) return;
  const ownerNames = owners?.map(o => [o.first_name, o.last_name].filter(Boolean).join(' ')).join(', ');
  throw new Error(
    `Forbidden: ${caller.entityRef} may not modify this Superset object ` +
      `(owners: ${ownerNames || 'none'}). Only an owner or a member of ${ADMIN_GROUP_REF} can edit or delete it.`,
  );
}
