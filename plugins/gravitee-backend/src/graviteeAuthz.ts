import { Config } from '@backstage/config';
import { graviteeSettings } from './graviteeClient';
import { GvApi, findGraviteeUser } from './graviteeApis';
import { KeycloakPerson, getKeycloakGroups, getKeycloakPerson } from './keycloakLookup';

// Authorization for the gravitee-manager routes ("option B", AUTHZ.md
// § gravitee-oneke §8):
//
//  * owner  -- the API's Gravitee PRIMARY_OWNER is the caller's own Gravitee
//              user. Native Gravitee ownership, nothing stored in Backstage.
//  * team   -- the API's `backstage-team` metadata is one of the caller's
//              CURRENT gravitee-team-* Keycloak groups. Read-only, and only in
//              Backstage: in the Console a teammate still gets 403.
//  * admin  -- backstage-admin (Backstage group ref) or gravitee-admin
//              (Keycloak group, the same group that makes someone a Gravitee
//              ORGANIZATION/ENVIRONMENT ADMIN).
//
// Deny by default: an API that matches none of the three is neither listed
// nor returned. The service-account token underneath can see everything, so
// this file is the only thing keeping users apart inside Backstage.

export const ADMIN_GROUP_REF = 'group:default/backstage-admin';
export const GRAVITEE_ADMIN_GROUP = 'gravitee-admin';
export const TEAM_GROUP_PREFIX = 'gravitee-team-';

export type Access = 'owner' | 'admin' | 'team';

export interface Caller {
  username: string;
  person: KeycloakPerson;
  /** gravitee-team-* groups the caller is in right now (live from Keycloak). */
  teams: string[];
  isAdmin: boolean;
  /** Undefined until the caller has a Gravitee user (first login or first API created). */
  graviteeUserId?: string;
}

export function usernameFromEntityRef(ref: string): string {
  return ref.replace(/^user:[^/]+\//, '');
}

export async function resolveCaller(
  config: Config,
  userEntityRef: string,
  ownershipEntityRefs: string[],
): Promise<Caller> {
  const username = usernameFromEntityRef(userEntityRef);
  const person = await getKeycloakPerson(config, username);
  const groups = await getKeycloakGroups(config, person);
  const gvUser = await findGraviteeUser(config, person, graviteeSettings(config).identityProvider);
  return {
    username,
    person,
    teams: groups.filter(g => g.startsWith(TEAM_GROUP_PREFIX)).sort(),
    isAdmin: ownershipEntityRefs.includes(ADMIN_GROUP_REF) || groups.includes(GRAVITEE_ADMIN_GROUP),
    graviteeUserId: gvUser?.id,
  };
}

/** What the caller may do with this API, or undefined = must not even see it. */
export function accessTo(caller: Caller, api: GvApi, team: string | undefined): Access | undefined {
  if (caller.graviteeUserId && api.primaryOwner?.type === 'USER' && api.primaryOwner.id === caller.graviteeUserId) {
    return 'owner';
  }
  if (caller.isAdmin) return 'admin';
  if (team && caller.teams.includes(team)) return 'team';
  return undefined;
}

export function canEdit(access: Access | undefined): boolean {
  return access === 'owner' || access === 'admin';
}
