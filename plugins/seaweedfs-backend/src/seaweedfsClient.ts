import { Config } from '@backstage/config';

// SeaweedFS Admin UI auth. Native form login (username/password + a
// session-bound CSRF token), NOT OIDC — the Admin UI's own native login is
// a single shared static account (WEED_ADMIN_USER/PASSWORD, no per-Keycloak-
// user concept), so there is no dedicated Keycloak-backed service account to
// authenticate as here, unlike Camunda's HTTP-Basic SA or Superset's DB-login
// SA. Per-user attribution for isolation purposes comes entirely from the
// `owner`/ownership-ledger fields this plugin sets on created objects, not
// from SeaweedFS's own session identity.
//
// CSRF: verified against the live fork this session built — enforced only
// on S3 Tables mutations (weed/admin/dash/s3tables_management.go), nowhere
// else (buckets/groups/policies/users). Sent on every mutating call anyway
// here, since it's cheap and the token is trivially available once logged
// in (embedded in every authenticated HTML page's `<meta name="csrf-token">`
// — weed/admin/view/layout/layout.templ) and accepted via the X-CSRF-Token
// header (weed/admin/dash/csrf.go), so there's no reason to special-case it
// per resource type.

interface CachedSession {
  cookie: string;
  csrfToken: string;
  expiresAt: number;
}

let cached: CachedSession | undefined;

function seaweedfsConfig(config: Config) {
  return config.getConfig('seaweedfsAdmin');
}

function extractSetCookie(res: Response): string | undefined {
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie') ?? ''].filter(Boolean);
  const adminSession = setCookies.find(c => c.startsWith('admin-session='));
  return adminSession?.split(';')[0];
}

function extractCsrfMeta(html: string): string | undefined {
  const match = html.match(/<meta name="csrf-token" content="([^"]+)"/);
  return match?.[1];
}

async function login(config: Config): Promise<CachedSession> {
  const sc = seaweedfsConfig(config);
  const baseUrl = sc.getString('baseUrl');
  const username = sc.getString('username');
  const password = sc.getString('password');

  const loginPage = await fetch(`${baseUrl}/login`);
  if (!loginPage.ok) {
    throw new Error(`Failed to load SeaweedFS login page: ${loginPage.status} ${await loginPage.text()}`);
  }
  const loginPageHtml = await loginPage.text();
  const formCsrfMatch = loginPageHtml.match(/name="csrf_token" value="([^"]+)"/);
  const formCsrfToken = formCsrfMatch?.[1];
  if (!formCsrfToken) {
    throw new Error('Failed to find csrf_token on the SeaweedFS login page');
  }
  const preAuthCookie = extractSetCookie(loginPage);

  const body = new URLSearchParams({ username, password, csrf_token: formCsrfToken });
  const res = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(preAuthCookie ? { Cookie: preAuthCookie } : {}),
    },
    body: body.toString(),
    redirect: 'manual',
  });
  // A successful login 303s to /admin; anything else means the credentials
  // (or the pre-auth CSRF cookie) were rejected.
  if (res.status !== 303 && res.status !== 302) {
    throw new Error(`Failed to log in to SeaweedFS Admin UI: ${res.status} ${await res.text()}`);
  }
  const sessionCookie = extractSetCookie(res);
  if (!sessionCookie) {
    throw new Error('SeaweedFS login did not return an admin-session cookie');
  }

  const homePage = await fetch(`${baseUrl}/admin`, { headers: { Cookie: sessionCookie } });
  const homeHtml = await homePage.text();
  const csrfToken = extractCsrfMeta(homeHtml);
  if (!csrfToken) {
    throw new Error('Failed to find the CSRF meta tag on an authenticated SeaweedFS Admin UI page');
  }

  // The session cookie itself is set with a 24h Max-Age (verified live) —
  // re-login well before that rather than tracking the exact expiry.
  return { cookie: sessionCookie, csrfToken, expiresAt: Date.now() + 20 * 60 * 60 * 1000 };
}

async function ensureSession(config: Config): Promise<CachedSession> {
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }
  cached = await login(config);
  return cached;
}

/**
 * Fetch against the SeaweedFS Admin UI's own JSON REST API (`/api/...`) as
 * the configured static admin account. Every mutating call carries the
 * session cookie plus X-CSRF-Token.
 */
export async function seaweedfsAdminFetch(
  config: Config,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const sc = seaweedfsConfig(config);
  const baseUrl = sc.getString('baseUrl');
  const session = await ensureSession(config);
  const method = (init.method ?? 'GET').toUpperCase();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Cookie: session.cookie,
    ...(init.headers as Record<string, string> | undefined),
  };
  if (method !== 'GET' && method !== 'HEAD') {
    headers['X-CSRF-Token'] = session.csrfToken;
  }

  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  // A stale cached session (e.g. the admin pod restarted) surfaces as a
  // redirect back to /login or a plain 401/403 — clear the cache once and
  // let the caller retry, rather than looping.
  if (res.status === 401 || (res.status >= 300 && res.status < 400)) {
    cached = undefined;
  }
  return res;
}

export function seaweedfsPublicUrl(config: Config): string {
  return (
    config.getOptionalString('seaweedfsPublicUrl') ??
    seaweedfsConfig(config).getOptionalString('baseUrl') ??
    ''
  );
}
