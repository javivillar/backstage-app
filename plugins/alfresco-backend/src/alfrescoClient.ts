import { Config } from '@backstage/config';

// Alfresco Public REST API auth. HTTP Basic only — verified live against
// this cluster (see charts/alfrescodms-oneke/files/sync-site-groups.py and
// INTEGRATION.md): Bearer JWTs from Keycloak are rejected outright
// ("Authorization 'Bearer' not supported"), and a ticket cannot be used as
// a Basic-Auth username either (only the ?alf_ticket= query param works,
// which just adds expiry bookkeeping for no benefit here). Basic Auth has
// no session/expiry to manage, so every call just sends the header fresh.
//
// personId convention: Alfresco's Person.id is keyed by **username**
// (Keycloak preferred_username), NOT email — confirmed live 2026-09-17.
// Using email here would silently create/target a second, orphaned Person
// nobody actually authenticates as (exactly the bug found and fixed the
// same day in sync-site-groups.py).

function alfrescoConfig(config: Config) {
  return config.getConfig('alfrescoAdmin');
}

function authHeader(config: Config): string {
  const ac = alfrescoConfig(config);
  const username = ac.getString('username');
  const password = ac.getString('password');
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

const API_PREFIX = '/alfresco/api/-default-/public/alfresco/versions/1';

/**
 * Fetch against Alfresco's Public REST API as the configured technical
 * account (`alfrescoAdmin.username`/`password` — see README.md). `path` is
 * relative to the versioned API root, e.g. `/sites` or
 * `/sites/foo/members`.
 */
export async function alfrescoFetch(
  config: Config,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const baseUrl = alfrescoConfig(config).getString('baseUrl').replace(/\/$/, '');
  const headers: Record<string, string> = {
    Authorization: authHeader(config),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(`${baseUrl}${API_PREFIX}${path}`, { ...init, headers });
}

export function alfrescoPublicUrl(config: Config): string {
  return (
    config.getOptionalString('alfrescoPublicUrl') ??
    alfrescoConfig(config).getOptionalString('baseUrl') ??
    ''
  );
}
