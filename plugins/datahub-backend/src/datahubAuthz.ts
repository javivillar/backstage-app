import { BackstageCredentials, UserInfoService } from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { getUserGroupNames } from './keycloakLookup';

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
