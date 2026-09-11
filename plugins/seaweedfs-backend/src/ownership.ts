import { BackstageCredentials, DatabaseService, UserInfoService } from '@backstage/backend-plugin-api';
import type { Knex } from 'knex';

export const ADMIN_GROUP_REF = 'group:default/backstage-admin';

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
    isAdmin: info.ownershipEntityRefs.includes(ADMIN_GROUP_REF),
  };
}

// ---------------------------------------------------------------------------
// Buckets & Table Buckets — native ownership (a real `owner` field SeaweedFS
// itself persists on the object, same as bucket_management.go's owner
// param/UpdateBucketOwner). Simple string comparison, unlike Superset's
// numeric-id indirection — SeaweedFS's owner field is already a plain
// username.
// ---------------------------------------------------------------------------

export function requireOwnerOrAdmin(
  caller: CallerInfo,
  resourceKind: string,
  ownerUsername: string | undefined,
): void {
  if (caller.isAdmin) return;
  if (ownerUsername && ownerUsername === caller.username) return;
  throw new Error(
    `Forbidden: ${caller.entityRef} may not modify this SeaweedFS ${resourceKind} ` +
      `(owner: ${ownerUsername || 'none'}). Only the owner or a member of ${ADMIN_GROUP_REF} can edit or delete it.`,
  );
}

// ---------------------------------------------------------------------------
// Groups & Policies — bolted-on ownership. SeaweedFS's IAM Group
// (weed/pb/iam_pb.Group: {Name, Members, PolicyNames, Disabled}) and Policy
// (a flat map[string]PolicyDocument) have no owner/extra field at all to
// bolt onto — unlike Superset's Database `extra` JSON column, there's no
// extensible point on the object itself. Ownership is tracked in Backstage's
// own database instead (coreServices.database, the standard backend
// service every stateful Backstage plugin uses — real Postgres in this
// deployment, not a new dependency).
//
// A simple "create table if missing" at plugin init, not Backstage's usual
// migrations-file convention — deliberate simplification for this single
// small table; revisit with real migrations if this ever needs a schema
// change in place.
// ---------------------------------------------------------------------------

export type OwnedResourceKind = 'group' | 'policy';

const TABLE_NAME = 'seaweedfs_ownership';

export async function ensureOwnershipTable(database: DatabaseService): Promise<Knex> {
  const knex = await database.getClient();
  const exists = await knex.schema.hasTable(TABLE_NAME);
  if (!exists) {
    await knex.schema.createTable(TABLE_NAME, table => {
      table.string('resource_kind', 32).notNullable();
      table.string('resource_name', 255).notNullable();
      table.string('owner_username', 255).notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.primary(['resource_kind', 'resource_name']);
    });
  }
  return knex;
}

export async function recordOwnership(
  knex: Knex,
  kind: OwnedResourceKind,
  name: string,
  ownerUsername: string,
): Promise<void> {
  await knex(TABLE_NAME)
    .insert({ resource_kind: kind, resource_name: name, owner_username: ownerUsername })
    .onConflict(['resource_kind', 'resource_name'])
    .merge();
}

export async function ownerOf(
  knex: Knex,
  kind: OwnedResourceKind,
  name: string,
): Promise<string | undefined> {
  const row = await knex(TABLE_NAME)
    .where({ resource_kind: kind, resource_name: name })
    .first('owner_username');
  return row?.owner_username;
}

/** All ownership rows for a kind, as a name -> owner map. */
export async function ownershipMap(
  knex: Knex,
  kind: OwnedResourceKind,
): Promise<Record<string, string>> {
  const rows = await knex(TABLE_NAME)
    .where({ resource_kind: kind })
    .select('resource_name', 'owner_username');
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.resource_name] = row.owner_username;
  }
  return map;
}

export async function forgetOwnership(knex: Knex, kind: OwnedResourceKind, name: string): Promise<void> {
  await knex(TABLE_NAME).where({ resource_kind: kind, resource_name: name }).delete();
}

/** Names owned by `username` for a given kind (empty for a name with no ownership row yet). */
export async function ownedNames(
  knex: Knex,
  kind: OwnedResourceKind,
  username: string,
): Promise<string[]> {
  const rows = await knex(TABLE_NAME)
    .where({ resource_kind: kind, owner_username: username })
    .select('resource_name');
  return rows.map(r => r.resource_name);
}
