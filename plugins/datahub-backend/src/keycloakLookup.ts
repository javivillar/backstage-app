import { Config } from '@backstage/config';

// Minimal Keycloak admin client, reusing the SAME `keycloakAdmin` config block
// (client-credentials service account `backstage-admin-sa`) the other manager
// plugins use. Duplicated on purpose, like activepieces-/seaweedfs-backend:
// cross-plugin imports would couple their release cycles.
//
// Used ONLY to read which Keycloak groups a Backstage user belongs to, so the
// plugin can apply the same access gate DataHub's own Keycloak login applies
// (datahub-* groups) -- see datahubAuthz.ts. READ ONLY: no write call here.

let cachedToken: { value: string; expiresAt: number } | undefined;

async function adminToken(config: Config): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 5000) return cachedToken.value;
  const kc = config.getConfig('keycloakAdmin');
  const res = await fetch(
    `${kc.getString('baseUrl')}/realms/${kc.getString('realm')}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: kc.getString('clientId'),
        client_secret: kc.getString('clientSecret'),
      }),
    },
  );
  if (!res.ok) throw new Error(`Failed to obtain Keycloak admin token: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expiresAt: now + body.expires_in * 1000 };
  return body.access_token;
}

async function kcGet<T>(config: Config, path: string): Promise<T> {
  const kc = config.getConfig('keycloakAdmin');
  const res = await fetch(`${kc.getString('baseUrl')}/admin/realms/${kc.getString('realm')}${path}`, {
    headers: { Authorization: `Bearer ${await adminToken(config)}` },
  });
  if (!res.ok) throw new Error(`Keycloak ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

// Short cache: group revocation must take effect quickly, but the gate runs on
// every request of a page load.
const groupCache = new Map<string, { groups: string[]; expiresAt: number }>();
const GROUP_TTL_MS = 30 * 1000;

/** Names of the Keycloak groups (any depth) the user belongs to. Unknown user => []. */
export async function getUserGroupNames(config: Config, username: string): Promise<string[]> {
  const hit = groupCache.get(username);
  if (hit && hit.expiresAt > Date.now()) return hit.groups;

  const users = await kcGet<Array<{ id: string }>>(config, `/users?username=${encodeURIComponent(username)}&exact=true`);
  let groups: string[] = [];
  if (users[0]?.id) {
    groups = (await kcGet<Array<{ name: string }>>(config, `/users/${users[0].id}/groups`)).map(g => g.name);
  }
  groupCache.set(username, { groups, expiresAt: Date.now() + GROUP_TTL_MS });
  return groups;
}

const emailCache = new Map<string, { email: string; expiresAt: number }>();

/** The user's email (DataHub identifies people by it, design §3). Throws if the user has none. */
export async function getUserEmail(config: Config, username: string): Promise<string> {
  const hit = emailCache.get(username);
  if (hit && hit.expiresAt > Date.now()) return hit.email;
  const users = await kcGet<Array<{ email?: string }>>(config, `/users?username=${encodeURIComponent(username)}&exact=true`);
  const email = users[0]?.email;
  if (!email) throw new Error(`Keycloak user "${username}" has no email, which DataHub needs to identify them`);
  emailCache.set(username, { email, expiresAt: Date.now() + 5 * 60 * 1000 });
  return email;
}
