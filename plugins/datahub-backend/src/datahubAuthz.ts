import { BackstageCredentials, UserInfoService } from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { DatahubSettings } from './datahubClient';
import { getUserEmail, getUserGroupNames } from './keycloakLookup';

export const ADMIN_GROUP_REF = 'group:default/backstage-admin';

export interface Caller {
  entityRef: string;
  username: string;
  isAdmin: boolean;
}

export class Forbidden extends Error {}

export function usernameFromEntityRef(entityRef: string): string {
  return entityRef.split('/').pop() ?? entityRef;
}

export async function callerFrom(
  credentials: BackstageCredentials,
  userInfo: UserInfoService,
): Promise<Caller> {
  const info = await userInfo.getUserInfo(credentials);
  return {
    entityRef: info.userEntityRef,
    username: usernameFromEntityRef(info.userEntityRef),
    isAdmin: info.ownershipEntityRefs.includes(ADMIN_GROUP_REF),
  };
}

/** Pure decision, unit-tested: may somebody with these Keycloak groups use the plugin? */
export function hasAccess(caller: Pick<Caller, 'isAdmin'>, groups: string[], accessGroups: string[]): boolean {
  return caller.isAdmin || groups.some(g => accessGroups.includes(g));
}

/**
 * The single authorization gate for every route. DENY BY DEFAULT.
 *
 * The plugin talks to DataHub with ONE platform-wide service-account token, so
 * DataHub itself cannot tell users apart for these calls -- the per-user rule
 * lives here (BACKSTAGE-DATAHUB-DESIGN.md §7.2). It is the SAME requirement
 * DataHub's own Keycloak login enforces (`datahub-gate`: a user in no
 * datahub-* group is denied), so the Backstage plugin cannot be used to
 * reopen the asset-name leak that gate closes.
 */
export async function requireDatahubAccess(
  config: Config,
  caller: Caller,
  accessGroups: string[],
): Promise<void> {
  if (caller.isAdmin) return;
  const groups = await getUserGroupNames(config, caller.username);
  if (!hasAccess(caller, groups, accessGroups)) {
    throw new Forbidden(
      `Forbidden: ${caller.entityRef} is not in any DataHub access group (${accessGroups.join(', ')}). ` +
        `Ask a DataHub admin to add you to one.`,
    );
  }
}

/**
 * Pure decision for the WRITE path (design §7.2), unit-tested:
 *  - backstage-admin and data stewards: anything;
 *  - otherwise the caller must be in a write group (viewers are read-only) AND,
 *    when the product already exists, be one of its owners -- directly (their
 *    email) or through a group they belong to. A NEW product needs only the
 *    write group: the launcher becomes its technical owner.
 */
export function canWrite(
  caller: Pick<Caller, 'isAdmin'>,
  email: string,
  groups: string[],
  s: Pick<DatahubSettings, 'writeGroups' | 'stewardGroups'>,
  existingOwners: string[] | undefined,
): boolean {
  if (caller.isAdmin || groups.some(g => s.stewardGroups.includes(g))) return true;
  if (!groups.some(g => s.writeGroups.includes(g))) return false;
  if (existingOwners === undefined) return true;
  const mine = new Set([`urn:li:corpuser:${email}`.toLowerCase(), ...groups.map(g => `urn:li:corpGroup:${g}`.toLowerCase())]);
  return existingOwners.some(o => mine.has(o.toLowerCase()));
}

export interface Capabilities {
  /** Every caller that gets this far can read (the access gate already ran). */
  canRead: true;
  /** May start the templates that CREATE things in DataHub (new product, register assets, deprecate). */
  canCreate: boolean;
  writesEnabled: boolean;
  isSteward: boolean;
}

/** What this user can do, so the UI shows only the buttons that will work. Pure, unit-tested. */
export function capabilitiesFor(
  caller: Pick<Caller, 'isAdmin'>,
  email: string,
  groups: string[],
  s: Pick<DatahubSettings, 'writesEnabled' | 'writeGroups' | 'stewardGroups'>,
): Capabilities {
  return {
    canRead: true,
    canCreate: s.writesEnabled && canWrite(caller, email, groups, s, undefined),
    writesEnabled: s.writesEnabled,
    isSteward: caller.isAdmin || groups.some(g => s.stewardGroups.includes(g)),
  };
}

export function assertWritesEnabled(s: Pick<DatahubSettings, 'writesEnabled'>): void {
  if (!s.writesEnabled) {
    throw new Forbidden('Forbidden: the DataHub write path is disabled (datahub.writes.enabled is not true).');
  }
}

export async function requireWriteAccess(
  config: Config,
  caller: Caller,
  s: DatahubSettings,
  existingOwners: string[] | undefined,
): Promise<{ email: string }> {
  assertWritesEnabled(s);
  const [email, groups] = await Promise.all([getUserEmail(config, caller.username), getUserGroupNames(config, caller.username)]);
  if (!canWrite(caller, email, groups, s, existingOwners)) {
    throw new Forbidden(
      existingOwners === undefined
        ? `Forbidden: ${caller.entityRef} is not in a DataHub write group (${s.writeGroups.join(', ')}).`
        : `Forbidden: ${caller.entityRef} is not an owner of this data product (nor a steward or backstage-admin).`,
    );
  }
  return { email };
}
