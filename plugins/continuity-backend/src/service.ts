import * as fs from 'fs';
import * as path from 'path';
import type { X509Certificate } from 'crypto';
import { loadProfiles } from './profiles';
import { buildSummary, flattenAnchors } from './status';
import { isKeycloakProbe, liveOfCa, liveOfRealmKeys, parseBundle } from './trust';
import type { ComputedProfile, FlatAnchor, LiveCert, Summary } from './types';

/** keycloakAdmin.* of app-config: the service account the Keycloak manager already uses. */
export type KeycloakSettings = { baseUrl: string; realm: string; clientId: string; clientSecret: string };

export type ContinuitySettings = {
  /** the mounted ConfigMap continuity-profiles: <service>.yaml */
  profilesDir: string;
  /** optional: platform-ca.pem = the root + intermediate CA of the platform */
  trustDir?: string;
  keycloak?: KeycloakSettings;
};

type Fetch = typeof fetch;
type RealmKeys = { live?: LiveCert; error?: string; warning?: string };

const KEYS_TTL = 5 * 60_000;

/** Reads the profiles on every call (small files; a ConfigMap update shows at once) and the live keys, cached. */
export class ContinuityService {
  private token?: { value: string; expiresAt: number };
  private keys?: { value: RealmKeys; at: number };

  constructor(private readonly settings: ContinuitySettings, private readonly fetchFn: Fetch = fetch, private readonly now: () => number = Date.now) {}

  async summary(): Promise<Summary> {
    const { profiles, warnings } = await loadProfiles(this.settings.profilesDir);
    const certs = await this.platformCerts(warnings);
    const needsKeycloak = profiles.some(p => p.trustAnchors.some(isKeycloakProbe));
    const realm = needsKeycloak ? await this.realmKeys() : {};
    if (realm.warning) warnings.push(realm.warning);
    const now = this.now();
    const anchors: FlatAnchor[] = flattenAnchors(profiles, (service, id) => {
      const a = profiles.find(p => p.service === service)!.trustAnchors.find(x => x.id === id)!;
      if (isKeycloakProbe(a)) return realm.live ? { live: realm.live } : { liveError: realm.error ?? realm.warning ?? 'Keycloak realm keys not read' };
      if (a.kind === 'ca') {
        if (!certs) return { liveError: 'No platform CA bundle (continuity.trustDir/platform-ca.pem)' };
        const live = liveOfCa(a, certs, now);
        return live ? { live } : { liveError: 'Not found in the platform CA bundle' };
      }
      return {};
    });
    return buildSummary(profiles, anchors, warnings);
  }

  async profile(service: string): Promise<ComputedProfile | undefined> {
    const s = await this.summary();
    const p = s.profiles.find(x => x.service === service);
    // its trust anchors with what the platform says of them (live, liveError)
    return p && { ...p, trustAnchors: s.trustAnchors.filter(a => a.service === service) };
  }

  private async platformCerts(warnings: string[]): Promise<X509Certificate[] | undefined> {
    if (!this.settings.trustDir) return undefined;
    const file = path.join(this.settings.trustDir, 'platform-ca.pem');
    try {
      const certs = parseBundle(await fs.promises.readFile(file, 'utf8'));
      if (!certs.length) warnings.push(`${file} has no certificate`);
      return certs;
    } catch (e) {
      warnings.push(`${file} cannot be read: ${(e as Error).message}`);
      return undefined;
    }
  }

  /** GET /admin/realms/<realm>/keys with the client_credentials token of keycloakAdmin; a 403 is a warning. */
  async realmKeys(): Promise<RealmKeys> {
    const kc = this.settings.keycloak;
    if (!kc) return { warning: 'keycloakAdmin is not configured: the realm keys are not read' };
    if (this.keys && this.now() - this.keys.at < KEYS_TTL) return this.keys.value;
    let value: RealmKeys;
    try {
      const res = await this.fetchFn(`${kc.baseUrl}/admin/realms/${kc.realm}/keys`, { headers: { Authorization: `Bearer ${await this.adminToken(kc)}` } });
      if (res.status === 403) {
        value = { warning: `Keycloak realm keys: the service account ${kc.clientId} lacks view-realm (403)` };
      } else if (!res.ok) {
        value = { error: `Keycloak realm keys: ${res.status} ${res.statusText}` };
      } else {
        const live = liveOfRealmKeys(await res.json(), this.now());
        value = live ? { live } : { error: 'Keycloak realm keys: no active signing key with a certificate' };
      }
    } catch (e) {
      value = { error: `Keycloak realm keys: ${(e as Error).message}` };
    }
    this.keys = { value, at: this.now() };
    return value;
  }

  private async adminToken(kc: KeycloakSettings): Promise<string> {
    if (this.token && this.token.expiresAt > this.now() + 5000) return this.token.value;
    const res = await this.fetchFn(`${kc.baseUrl}/realms/${kc.realm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: kc.clientId, client_secret: kc.clientSecret }),
    });
    if (!res.ok) throw new Error(`token ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: this.now() + body.expires_in * 1000 };
    return body.access_token;
  }
}
