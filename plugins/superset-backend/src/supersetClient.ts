import { Config } from '@backstage/config';

// Superset REST API auth. AUTH_TYPE is AUTH_OAUTH (human logins go through
// Keycloak SSO), but the DB-provider login endpoint still works for a local
// service account — verified live against superset-oneke 5.0.0. Mutating
// calls additionally need Superset's CSRF token *and* the session cookie it
// was issued with (Flask-WTF validates the header against the cookie, not
// just the bearer token) — see ensureCsrf below.

interface CachedAuth {
  accessToken: string;
  accessExpiresAt: number;
  csrfToken?: string;
  sessionCookie?: string;
}

let cached: CachedAuth | undefined;

function supersetConfig(config: Config) {
  return config.getConfig('supersetAdmin');
}

async function login(config: Config): Promise<{ accessToken: string; expiresAt: number }> {
  const sc = supersetConfig(config);
  const baseUrl = sc.getString('baseUrl');
  const username = sc.getString('username');
  const password = sc.getString('password');

  const res = await fetch(`${baseUrl}/api/v1/security/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, provider: 'db', refresh: true }),
  });
  if (!res.ok) {
    throw new Error(`Failed to log in to Superset: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token: string };
  // Superset access tokens are short-lived (15 min); re-login well before
  // expiry rather than parsing the JWT for the real exp.
  return { accessToken: body.access_token, expiresAt: Date.now() + 10 * 60 * 1000 };
}

async function ensureAccessToken(config: Config): Promise<string> {
  if (cached && cached.accessExpiresAt > Date.now()) {
    return cached.accessToken;
  }
  const { accessToken, expiresAt } = await login(config);
  cached = { accessToken, accessExpiresAt: expiresAt };
  return accessToken;
}

async function ensureCsrf(
  config: Config,
  accessToken: string,
): Promise<{ csrfToken: string; sessionCookie: string }> {
  if (cached?.csrfToken && cached.sessionCookie) {
    return { csrfToken: cached.csrfToken, sessionCookie: cached.sessionCookie };
  }
  const sc = supersetConfig(config);
  const baseUrl = sc.getString('baseUrl');
  const res = await fetch(`${baseUrl}/api/v1/security/csrf_token/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to obtain Superset CSRF token: ${res.status} ${await res.text()}`);
  }
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie') ?? ''].filter(Boolean);
  const sessionCookie = setCookies.map(c => c.split(';')[0]).join('; ');
  const body = (await res.json()) as { result: string };
  if (cached) {
    cached.csrfToken = body.result;
    cached.sessionCookie = sessionCookie;
  }
  return { csrfToken: body.result, sessionCookie };
}

/**
 * Fetch against Superset's REST API as the `backstage-superset-sa` service
 * account. GETs only need the bearer token; mutating verbs also carry the
 * CSRF token + the session cookie it was minted with.
 */
export async function supersetAdminFetch(
  config: Config,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const sc = supersetConfig(config);
  const baseUrl = sc.getString('baseUrl');
  const accessToken = await ensureAccessToken(config);
  const method = (init.method ?? 'GET').toUpperCase();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    ...(init.headers as Record<string, string> | undefined),
  };

  if (method !== 'GET' && method !== 'HEAD') {
    const { csrfToken, sessionCookie } = await ensureCsrf(config, accessToken);
    headers['X-CSRFToken'] = csrfToken;
    headers.Cookie = sessionCookie;
  }

  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  // A stale cached csrf/session (e.g. Superset restarted) surfaces as 401 —
  // clear the auth cache once and let the caller retry, rather than looping.
  if (res.status === 401 && cached) {
    cached = undefined;
  }
  return res;
}

/** Rison-encode a single quoted string for `q=` filter params. Superset's
 * "related" and list endpoints use Rison, but every value this module needs
 * to encode is a plain username/id — full Rison isn't worth pulling in as a
 * dependency for that. */
function risonString(value: string): string {
  return `'${value.replace(/'/g, "\\'")}'`;
}

export async function findSupersetUserId(
  config: Config,
  username: string,
): Promise<number | undefined> {
  const q = encodeURIComponent(`(filter:${risonString(username)})`);
  const res = await supersetAdminFetch(config, `/api/v1/dataset/related/owners?q=${q}`);
  if (!res.ok) {
    throw new Error(`Failed to look up Superset user "${username}": ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { result: Array<{ text: string; value: number }> };
  // "text" is "<first_name> <last_name>"; our accounts always set
  // first_name = username (see superset-authz-implementation), so match on
  // the leading token rather than requiring an exact full-string match.
  const match = body.result.find(r => r.text.split(' ')[0] === username);
  return match?.value;
}

export function ownersFilterQuery(userId: number): string {
  return encodeURIComponent(
    `(filters:!((col:owners,opr:rel_m_m,value:${userId})))`,
  );
}
