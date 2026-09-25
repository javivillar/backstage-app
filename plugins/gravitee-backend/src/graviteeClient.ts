import { Config } from '@backstage/config';

// Gravitee APIM Management API client, authenticated as the service account
// `gravitee-backstage-sa` (a real Keycloak user in the gravitee-admin group ->
// Gravitee ORGANIZATION:ADMIN + ENVIRONMENT:ADMIN).
//
// Login is the same one a browser does, minus the browser: a Keycloak
// password-grant token (issued to Backstage's own `backstage` client) is
// swapped for a Gravitee JWT at
//   POST /organizations/{org}/auth/oauth2/{idp}/exchange?token=<kc token>
// (path is `exchange`, no underscore). Gravitee introspects the token and
// applies its roleMapping exactly as for an interactive SSO login.
//
// IMPORTANT: this account sees and can modify EVERY API. Gravitee's own
// per-API membership (PRIMARY_OWNER) keeps users apart in the Console, but
// calls made with this token are not filtered by Gravitee at all -- every
// route in managerPlugin.ts must go through graviteeAuthz.ts first.

interface GraviteeSettings {
  baseUrl: string;
  username: string;
  password: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  identityProvider: string;
  organizationId: string;
  environmentId: string;
}

export function graviteeSettings(config: Config): GraviteeSettings {
  const gc = config.getConfig('graviteeAdmin');
  return {
    baseUrl: gc.getString('baseUrl').replace(/\/$/, ''),
    username: gc.getString('username'),
    password: gc.getString('password'),
    tokenUrl: gc.getString('tokenUrl'),
    clientId: gc.getString('clientId'),
    clientSecret: gc.getString('clientSecret'),
    identityProvider: gc.getOptionalString('identityProvider') ?? 'keycloak',
    organizationId: gc.getOptionalString('organizationId') ?? 'DEFAULT',
    environmentId: gc.getOptionalString('environmentId') ?? 'DEFAULT',
  };
}

export function isGraviteeConfigured(config: Config): boolean {
  return config.has('graviteeAdmin.baseUrl') && config.has('graviteeAdmin.password');
}

let cachedToken: { value: string; expiresAt: number } | undefined;

/** `exp` of a JWT (ms), or a conservative 10 minutes when it can't be read. */
function jwtExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (typeof payload.exp === 'number') return payload.exp * 1000;
  } catch {
    // fall through
  }
  return Date.now() + 10 * 60 * 1000;
}

async function login(s: GraviteeSettings): Promise<string> {
  const kc = await fetch(s.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: s.clientId,
      client_secret: s.clientSecret,
      username: s.username,
      password: s.password,
      scope: 'openid',
    }),
  });
  if (!kc.ok) throw new Error(`Keycloak login of ${s.username} failed: ${kc.status} ${await kc.text()}`);
  const accessToken = ((await kc.json()) as { access_token: string }).access_token;

  const url =
    `${s.baseUrl}/organizations/${s.organizationId}/auth/oauth2/${s.identityProvider}` +
    `/exchange?token=${encodeURIComponent(accessToken)}`;
  const gx = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: accessToken }),
  });
  if (!gx.ok) throw new Error(`Gravitee token exchange failed: ${gx.status} ${await gx.text()}`);
  const token = ((await gx.json()) as { token: string }).token;
  cachedToken = { value: token, expiresAt: jwtExpiry(token) };
  return token;
}

async function serviceToken(s: GraviteeSettings, forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  return login(s);
}

/**
 * Raw call relative to the Management API root (`.../management`). Paths
 * starting with `/v2/` hit Management API v2; anything else is v1. Retries
 * once with a fresh login on 401 (token revoked, apim-api restarted, ...).
 */
export async function gvFetch(config: Config, path: string, init: RequestInit = {}): Promise<Response> {
  const s = graviteeSettings(config);
  const doFetch = async (t: string) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${t}`,
      Accept: 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(`${s.baseUrl}${path}`, { ...init, headers });
  };
  let res = await doFetch(await serviceToken(s));
  if (res.status === 401) res = await doFetch(await serviceToken(s, true));
  return res;
}

export class GraviteeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Like gvFetch but parses JSON and throws a GraviteeError (with Gravitee's own message) on non-2xx. */
export async function gvJson<T>(config: Config, path: string, init: RequestInit = {}): Promise<T> {
  const res = await gvFetch(config, path, init);
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      // not JSON
    }
    throw new GraviteeError(`Gravitee ${init.method ?? 'GET'} ${path.split('?')[0]} failed: ${res.status} ${message}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function orgPath(config: Config): string {
  return `/organizations/${graviteeSettings(config).organizationId}`;
}

export function envPath(config: Config): string {
  const s = graviteeSettings(config);
  return `/organizations/${s.organizationId}/environments/${s.environmentId}`;
}

export function envV2Path(config: Config): string {
  return `/v2/environments/${graviteeSettings(config).environmentId}`;
}

// --- Browser-facing URLs ------------------------------------------------------

export function graviteePublicUrl(config: Config): string {
  return (config.getOptionalString('graviteePublicUrl') ?? '').replace(/\/$/, '');
}

/** Context-path prefix the gateway Ingress routes on (no stripping). */
export function gatewayPathPrefix(config: Config): string {
  return (config.getOptionalString('graviteeAdmin.gatewayPathPrefix') ?? '/gateway').replace(/\/$/, '');
}

export function consoleApiUrl(config: Config, apiId: string): string {
  // APIM 4 Console routes are /console/#!/<environmentId>/apis/<apiId>.
  const s = graviteeSettings(config);
  return `${graviteePublicUrl(config)}/console/#!/${s.environmentId}/apis/${apiId}`;
}

export function gatewayUrl(config: Config, contextPath: string): string {
  return `${graviteePublicUrl(config)}${contextPath}`;
}
