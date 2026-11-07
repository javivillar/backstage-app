import * as fs from 'fs';
import * as path from 'path';
import { ContinuityService } from './service';

const FIX = path.join(__dirname, '__fixtures__');
const kcCert = fs.readFileSync(path.join(FIX, 'keycloak-cert.b64'), 'utf8').trim();
const KC = { baseUrl: 'https://kc.example', realm: 'cnoe', clientId: 'backstage-admin', clientSecret: 's' };
const NOW = () => Date.parse('2031-10-01T00:00:00Z');

const json = (status: number, body: unknown) => ({ ok: status < 300, status, statusText: String(status), json: async () => body }) as unknown as Response;

/** A fake fetch: the token endpoint, then the keys endpoint answered with keysStatus. */
const fakeFetch = (keysStatus: number) => {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(String(url));
    if (String(url).endsWith('/token')) return json(200, { access_token: 't', expires_in: 300 });
    return json(keysStatus, { keys: [{ algorithm: 'RS256', use: 'SIG', status: 'ACTIVE', certificate: kcCert }] });
  }) as unknown as typeof fetch;
  return { fn, calls };
};

describe('ContinuityService', () => {
  it('reads the profiles, the platform CA bundle and the realm keys', async () => {
    const { fn, calls } = fakeFetch(200);
    const s = await new ContinuityService({ profilesDir: path.join(FIX, 'profiles'), trustDir: path.join(FIX, 'trust'), keycloak: KC }, fn, NOW).summary();
    const live = Object.fromEntries(s.trustAnchors.map(a => [a.id, a.live?.notAfter.slice(0, 10) ?? a.liveError ?? '']));
    expect(live).toEqual({ 'cosign-key': '', 'realm-keys': '2036-11-04', 'platform-root-ca': '2036-11-04', 'platform-intermediate-ca': '2031-11-06' });
    expect(calls).toEqual(['https://kc.example/realms/cnoe/protocol/openid-connect/token', 'https://kc.example/admin/realms/cnoe/keys']);
    // the intermediate expires in 36 days: pki-oneke warns
    expect(s.profiles.find(p => p.service === 'pki-oneke')?.reasons.map(r => r.key)).toEqual(['record-no-export', 'cert-expiring']);
    expect(s.attention[0]).toMatchObject({ level: 'critical', service: 'github', key: 'external-no-export' });
    expect(s.trustAnchors.every(a => a.ceremony === 'unrecorded')).toBe(true);
    expect(s.warnings).toContain('broken.yaml: no service');
  });

  it('turns a 403 of Keycloak into a warning, and a missing bundle into liveError', async () => {
    const { fn } = fakeFetch(403);
    const s = await new ContinuityService({ profilesDir: path.join(FIX, 'profiles'), keycloak: KC }, fn, NOW).summary();
    expect(s.warnings).toContain('Keycloak realm keys: the service account backstage-admin lacks view-realm (403)');
    expect(s.trustAnchors.find(a => a.id === 'realm-keys')?.liveError).toMatch(/view-realm/);
    expect(s.trustAnchors.find(a => a.id === 'platform-root-ca')?.liveError).toMatch(/platform-ca.pem/);
  });

  it('keeps to what the catalog says is installed, the externals always', async () => {
    const installed = async () => new Set(['iam-oneke', 'cnoe-oneke']);
    const svc = new ContinuityService({ profilesDir: path.join(FIX, 'profiles') }, fakeFetch(200).fn, NOW, installed);
    const s = await svc.summary();
    expect(s.profiles.map(p => p.service)).toEqual(['github', 'harbor', 'iam-oneke']);
    expect(s.notInstalled.map(p => p.service)).toEqual(['bpm-oneke', 'pki-oneke']);
    expect(s.trustAnchors.map(a => a.id)).toEqual(['cosign-key', 'realm-keys']);
    expect((await svc.profile('pki-oneke'))?.installed).toBe(false);
  });

  it('counts everything as installed when the catalog cannot be read', async () => {
    const failing = async (): Promise<ReadonlySet<string>> => {
      throw new Error('catalog down');
    };
    const s = await new ContinuityService({ profilesDir: path.join(FIX, 'profiles') }, fakeFetch(200).fn, NOW, failing).summary();
    expect(s.notInstalled).toEqual([]);
    expect(s.warnings).toContain('The catalog could not be read, every profile counts as installed: catalog down');
  });

  it('gives one profile with its live trust anchors', async () => {
    const p = await new ContinuityService({ profilesDir: path.join(FIX, 'profiles'), trustDir: path.join(FIX, 'trust') }, fakeFetch(200).fn, NOW).profile('pki-oneke');
    expect(p?.trustAnchors.map(a => (a as { live?: unknown }).live !== undefined)).toEqual([true, true]);
    expect(await new ContinuityService({ profilesDir: path.join(FIX, 'profiles') }).profile('nope')).toBeUndefined();
  });
});
