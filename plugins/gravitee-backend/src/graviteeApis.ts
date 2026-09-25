import { Config } from '@backstage/config';
import { envPath, envV2Path, gvJson, orgPath } from './graviteeClient';
import { KeycloakPerson } from './keycloakLookup';

// Thin wrappers over the Gravitee endpoints this plugin uses. Every one of
// them was exercised live with real logins before being written here (see
// AUTHZ.md § gravitee-oneke §8). None of them performs an authorization check:
// that is graviteeAuthz.ts' job, before any of these is called.

/** API metadata key carrying the owning team (a gravitee-team-* Keycloak group). */
export const TEAM_METADATA_KEY = 'backstage-team';

export interface GvApi {
  id: string;
  name: string;
  apiVersion: string;
  description?: string;
  definitionVersion: string;
  type: string;
  state?: string;
  visibility?: string;
  lifecycleState?: string;
  deploymentState?: string;
  createdAt?: string;
  updatedAt?: string;
  primaryOwner?: { id: string; email?: string; displayName?: string; type: string };
  listeners?: Array<{ type: string; paths?: Array<{ path: string }> }>;
  endpointGroups?: Array<{ endpoints?: Array<{ configuration?: { target?: string } }> }>;
}

interface V2Page<T> {
  data?: T[];
  pagination?: { page: number; pageCount: number };
}

export async function listAllApis(config: Config): Promise<GvApi[]> {
  const out: GvApi[] = [];
  for (let page = 1; ; page++) {
    const res = await gvJson<V2Page<GvApi>>(config, `${envV2Path(config)}/apis?page=${page}&perPage=100`);
    out.push(...(res.data ?? []));
    if (!res.pagination || page >= res.pagination.pageCount) return out;
  }
}

export async function getApi(config: Config, apiId: string): Promise<GvApi> {
  return gvJson<GvApi>(config, `${envV2Path(config)}/apis/${encodeURIComponent(apiId)}`);
}

export function contextPathOf(api: GvApi): string | undefined {
  return api.listeners?.find(l => l.type === 'HTTP')?.paths?.[0]?.path;
}

export function backendUrlOf(api: GvApi): string | undefined {
  return api.endpointGroups?.[0]?.endpoints?.[0]?.configuration?.target;
}

export async function getTeam(config: Config, apiId: string): Promise<string | undefined> {
  const md = await gvJson<Array<{ key: string; value?: string }>>(
    config,
    `${envPath(config)}/apis/${encodeURIComponent(apiId)}/metadata`,
  );
  return md.find(m => m.key === TEAM_METADATA_KEY)?.value || undefined;
}

// --- Users ------------------------------------------------------------------

interface GvUser {
  id: string;
  source?: string;
  sourceId?: string;
  email?: string;
}

/** The Gravitee user bound to this Keycloak user (source=keycloak, sourceId=<Keycloak id>), if any. */
export async function findGraviteeUser(
  config: Config,
  person: KeycloakPerson,
  identityProvider: string,
): Promise<GvUser | undefined> {
  const res = await gvJson<{ data?: GvUser[] }>(
    config,
    `${orgPath(config)}/users?q=${encodeURIComponent(person.email)}&size=50`,
  );
  return (res.data ?? []).find(u => u.source === identityProvider && u.sourceId === person.id);
}

/**
 * Pre-registers a Keycloak user who has never logged into Gravitee. Their
 * first OIDC login then binds to this same user (verified: no duplicate), so
 * ownership can be handed to someone before they ever open the Console.
 */
export async function preRegisterUser(config: Config, person: KeycloakPerson, identityProvider: string): Promise<GvUser> {
  return gvJson<GvUser>(config, `${orgPath(config)}/users`, {
    method: 'POST',
    body: JSON.stringify({
      firstname: person.firstName ?? person.username,
      lastname: person.lastName ?? '',
      email: person.email,
      source: identityProvider,
      sourceId: person.id,
      service: false,
    }),
  });
}

export async function ensureGraviteeUser(config: Config, person: KeycloakPerson, identityProvider: string): Promise<string> {
  const existing = await findGraviteeUser(config, person, identityProvider);
  return (existing ?? (await preRegisterUser(config, person, identityProvider))).id;
}

let serviceAccountUserId: string | undefined;

/** Gravitee user id of the service account itself (to drop its membership after a transfer). */
export async function selfUserId(config: Config): Promise<string> {
  if (!serviceAccountUserId) {
    serviceAccountUserId = (await gvJson<{ id: string }>(config, `${orgPath(config)}/user`)).id;
  }
  return serviceAccountUserId;
}

// --- Create -----------------------------------------------------------------

export interface NewApi {
  name: string;
  version: string;
  description: string;
  contextPath: string;
  backendUrl: string;
  team: string;
}

/**
 * "Soft" creation: a v4 HTTP proxy API, PRIVATE, STOPPED, unpublished, no
 * plans. Plans, policies, docs, publication and deployment are left to the
 * owner in the Gravitee Console. Created by the service account, tagged with
 * its team, then handed to `ownerUserId` as PRIMARY_OWNER; the service
 * account removes its own membership so the owner is the only member.
 * Rolls back (deletes the API) if any step after creation fails.
 */
export async function createOwnedApi(config: Config, input: NewApi, ownerUserId: string): Promise<GvApi> {
  const api = await gvJson<GvApi>(config, `${envV2Path(config)}/apis`, {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      apiVersion: input.version,
      description: input.description,
      definitionVersion: 'V4',
      type: 'PROXY',
      listeners: [{ type: 'HTTP', paths: [{ path: input.contextPath }], entrypoints: [{ type: 'http-proxy' }] }],
      endpointGroups: [
        {
          name: 'default',
          type: 'http-proxy',
          // endpoint name must differ from the group's ("default") or Gravitee answers 400
          endpoints: [{ name: 'backend', type: 'http-proxy', configuration: { target: input.backendUrl } }],
        },
      ],
    }),
  });
  try {
    await gvJson(config, `${envPath(config)}/apis/${encodeURIComponent(api.id)}/metadata`, {
      method: 'POST',
      body: JSON.stringify({ name: TEAM_METADATA_KEY, format: 'STRING', value: input.team }),
    });
    await gvJson(config, `${envV2Path(config)}/apis/${encodeURIComponent(api.id)}/_transfer-ownership`, {
      method: 'POST',
      body: JSON.stringify({ userId: ownerUserId, userType: 'USER', poRole: 'OWNER' }),
    });
    const self = await selfUserId(config);
    if (self !== ownerUserId) {
      await gvJson(config, `${envV2Path(config)}/apis/${encodeURIComponent(api.id)}/members/${encodeURIComponent(self)}`, {
        method: 'DELETE',
      });
    }
  } catch (e) {
    await gvJson(config, `${envV2Path(config)}/apis/${encodeURIComponent(api.id)}`, { method: 'DELETE' }).catch(() => {});
    throw e;
  }
  return getApi(config, api.id);
}
