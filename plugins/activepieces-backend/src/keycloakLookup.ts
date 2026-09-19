import { Config } from '@backstage/config';

// Minimal Keycloak admin client, reusing the SAME `keycloakAdmin` config
// block (client-credentials service account `backstage-admin-sa`) the
// keycloak-backend plugin already uses. It is duplicated here (rather than
// imported) on purpose, matching how alfresco-/seaweedfs-backend are
// self-contained: cross-plugin imports would couple their release cycles.
//
// Used for two things only:
//  1. resolving a Backstage username -> the user's real email/name (the
//     identity Activepieces knows them by), and
//  2. making sure that user is in the `activepieces-user` group, which is
//     the Activepieces access gate (a Keycloak user in no
//     activepieces-* group gets 403 at SSO login).

export const ACCESS_GROUP = 'activepieces-user';

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

async function kcFetch(config: Config, path: string, init: RequestInit = {}): Promise<Response> {
  const kc = config.getConfig('keycloakAdmin');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await adminToken(config)}`,
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${kc.getString('baseUrl')}/admin/realms/${kc.getString('realm')}${path}`, { ...init, headers });
}

export interface KeycloakPerson {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

const personCache = new Map<string, { person: KeycloakPerson; expiresAt: number }>();
const PERSON_TTL_MS = 5 * 60 * 1000;

/** Exact-username lookup. Throws a clear error if the user or its email is missing. */
export async function getKeycloakPerson(config: Config, username: string): Promise<KeycloakPerson> {
  const hit = personCache.get(username);
  if (hit && hit.expiresAt > Date.now()) return hit.person;

  const res = await kcFetch(config, `/users?username=${encodeURIComponent(username)}&exact=true`);
  if (!res.ok) throw new Error(`Keycloak user lookup failed: ${res.status} ${await res.text()}`);
  const found = (await res.json()) as Array<Partial<KeycloakPerson>>;
  const u = found[0];
  if (!u?.id || !u.username) throw new Error(`No Keycloak user named "${username}"`);
  if (!u.email) throw new Error(`Keycloak user "${username}" has no email, which Activepieces needs to identify them`);
  const person: KeycloakPerson = { id: u.id, username: u.username, email: u.email, firstName: u.firstName, lastName: u.lastName };
  personCache.set(username, { person, expiresAt: Date.now() + PERSON_TTL_MS });
  return person;
}

/** Idempotently adds the user to the Activepieces access-gate group. */
export async function ensureAccessGroup(config: Config, person: KeycloakPerson): Promise<void> {
  const memberships = await kcFetch(config, `/users/${person.id}/groups`);
  if (!memberships.ok) throw new Error(`Keycloak group lookup failed: ${memberships.status} ${await memberships.text()}`);
  const current = (await memberships.json()) as Array<{ name: string }>;
  if (current.some(g => g.name === ACCESS_GROUP)) return;

  const groups = await kcFetch(config, `/groups?search=${encodeURIComponent(ACCESS_GROUP)}&exact=true`);
  if (!groups.ok) throw new Error(`Keycloak group search failed: ${groups.status} ${await groups.text()}`);
  const group = ((await groups.json()) as Array<{ id: string; name: string }>).find(g => g.name === ACCESS_GROUP);
  if (!group) throw new Error(`Keycloak group "${ACCESS_GROUP}" does not exist in the realm`);

  const put = await kcFetch(config, `/users/${person.id}/groups/${group.id}`, { method: 'PUT' });
  if (!put.ok) throw new Error(`Failed to add ${person.username} to "${ACCESS_GROUP}": ${put.status} ${await put.text()}`);
}
