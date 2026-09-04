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
 * Superset tracks `owners` natively on Chart/Dashboard/Dataset — but NOT on
 * Database (connections): verified live (raw SQL) that this Superset
 * version's `dbs` table has no owner join table at all. The REST API
 * accepts an `owners` field in create/update payloads without erroring, but
 * silently drops it — nothing is persisted. So Database ownership uses the
 * SAME bolted-on-attribute philosophy as Keycloak's OWNER_ATTR (see
 * plugins/keycloak-backend): a `backstage_owner` key (the Backstage
 * username, a plain string) embedded in Database's own `extra` JSON column
 * — which Superset DOES persist reliably (verified via raw SQL) and expose,
 * but only on the LIST endpoint, not the single-object GET (verified live:
 * detail GET's show_columns excludes both `extra` and `owners` for
 * Database, while the list's list_columns includes `extra`).
 *
 * For Chart/Dashboard/Dataset, Backstage still has to enforce ownership
 * itself despite it being native to Superset: Backstage talks to Superset
 * through one shared service account, not per-user SSO, so Superset's own
 * ownership-based visibility never sees the real caller.
 */
export type SupersetResource = 'database' | 'dataset' | 'chart' | 'dashboard';

export function connectionOwnerFromExtra(extra: unknown): string | undefined {
  if (typeof extra !== 'string' || !extra) return undefined;
  try {
    const parsed = JSON.parse(extra) as { backstage_owner?: string };
    return parsed.backstage_owner;
  } catch {
    return undefined;
  }
}

/**
 * List a Superset resource scoped to the caller's own objects, or
 * everything for a backstage-admin member.
 *
 * dataset/chart/dashboard: pushes the owner filter into Superset's own
 * Rison `q` query (native `owners` relation, server-side filter).
 *
 * database: no native owner relation to filter on server-side at all (see
 * above) — fetches the plain list (which includes `extra`) and filters in
 * Node by parsing each item's `backstage_owner`.
 */
export async function listSupersetObjects(
  config: Config,
  resource: SupersetResource,
  caller: CallerInfo,
): Promise<Record<string, unknown>[]> {
  if (resource === 'database') {
    const res = await supersetAdminFetch(config, '/api/v1/database/');
    if (!res.ok) {
      throw new Error(`Failed to list Superset connections: ${res.status} ${await res.text()}`);
    }
    const all = ((await res.json()) as { result: Record<string, unknown>[] }).result;
    if (caller.isAdmin) return all;
    return all.filter(item => connectionOwnerFromExtra(item.extra) === caller.username);
  }

  if (caller.isAdmin) {
    const res = await supersetAdminFetch(config, `/api/v1/${resource}/`);
    if (!res.ok) {
      throw new Error(`Failed to list Superset ${resource}s: ${res.status} ${await res.text()}`);
    }
    return ((await res.json()) as { result: Record<string, unknown>[] }).result;
  }

  const ownerId = await callerSupersetOwnerId(config, caller);
  const res = await supersetAdminFetch(config, `/api/v1/${resource}/?q=${ownersFilterQuery(ownerId)}`);
  if (!res.ok) {
    throw new Error(`Failed to list Superset ${resource}s: ${res.status} ${await res.text()}`);
  }
  return ((await res.json()) as { result: Record<string, unknown>[] }).result;
}

// Superset's single-object GET returns `owners` as { id, first_name,
// last_name } — NO `username` field (verified live) — so ownership has to
// be compared by numeric Superset user id, not username. Callers must
// already have resolved the caller's own Superset id (callerSupersetOwnerId)
// before calling this, since that itself requires an API round-trip.
// NOT used for `database` — see requireConnectionOwnerOrAdmin instead.
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

export function requireConnectionOwnerOrAdmin(caller: CallerInfo, ownerUsername: string | undefined): void {
  if (caller.isAdmin) return;
  if (ownerUsername && ownerUsername === caller.username) return;
  throw new Error(
    `Forbidden: ${caller.entityRef} may not modify this Superset connection ` +
      `(owner: ${ownerUsername ?? 'none'}). Only the owner or a member of ${ADMIN_GROUP_REF} can edit or delete it.`,
  );
}
