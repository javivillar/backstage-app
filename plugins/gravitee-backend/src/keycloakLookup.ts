import { Config } from '@backstage/config';

// Minimal Keycloak admin client, reusing the SAME `keycloakAdmin` config
// block (client-credentials service account `backstage-admin-sa`) the
// keycloak-backend plugin already uses. Duplicated here (rather than
// imported) on purpose, like activepieces-/alfresco-/seaweedfs-backend:
// cross-plugin imports would couple their release cycles.
//
// Used for two things only:
//  1. resolving a Backstage username -> the Keycloak user id (Gravitee's
//     `sourceId` for users coming from the `keycloak` identity provider),
//     email and name, needed to find or pre-register the Gravitee user, and
//  2. reading the caller's CURRENT Keycloak groups (team membership is
//     checked live on every request, not taken from the Backstage session,
//     so removing someone from a gravitee-team-* group takes effect at once).

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

async function kcFetch(config: Config, path: string): Promise<Response> {
  const kc = config.getConfig('keycloakAdmin');
  return fetch(`${kc.getString('baseUrl')}/admin/realms/${kc.getString('realm')}${path}`, {
    headers: { Authorization: `Bearer ${await adminToken(config)}` },
  });
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
  if (!u.email) throw new Error(`Keycloak user "${username}" has no email, which Gravitee needs to identify them`);
  const person: KeycloakPerson = { id: u.id, username: u.username, email: u.email, firstName: u.firstName, lastName: u.lastName };
  personCache.set(username, { person, expiresAt: Date.now() + PERSON_TTL_MS });
  return person;
}

/** The user's current Keycloak group names (top-level names, no path). Never cached. */
export async function getKeycloakGroups(config: Config, person: KeycloakPerson): Promise<string[]> {
  const res = await kcFetch(config, `/users/${person.id}/groups?briefRepresentation=true&max=500`);
  if (!res.ok) throw new Error(`Keycloak group lookup failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as Array<{ name: string }>).map(g => g.name);
}
