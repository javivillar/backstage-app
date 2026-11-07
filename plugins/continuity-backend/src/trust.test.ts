import * as fs from 'fs';
import * as path from 'path';
import { isSelfSigned, liveOfCa, liveOfRealmKeys, parseBundle, wantsIntermediate } from './trust';

const FIX = path.join(__dirname, '__fixtures__');
// openssl test CA: root valid until 2036-11-04, intermediate until 2031-11-06 (both issued 2026-11-07)
const bundle = fs.readFileSync(path.join(FIX, 'trust', 'platform-ca.pem'), 'utf8');
const kcCert = fs.readFileSync(path.join(FIX, 'keycloak-cert.b64'), 'utf8').trim();
const NOW = Date.parse('2031-10-01T00:00:00Z');

describe('trust anchors', () => {
  const certs = parseBundle(bundle);

  it('reads the root and the intermediate of the bundle', () => {
    expect(certs).toHaveLength(2);
    expect(certs.map(isSelfSigned)).toEqual([true, false]);
    expect(parseBundle('garbage')).toEqual([]);
  });

  it('matches the root to the self-signed certificate and the intermediate to the other one', () => {
    const root = liveOfCa({ id: 'platform-root-ca', kind: 'ca', probe: 'configmap:pki-oneke/step-ca-certs/root_ca.crt' }, certs, NOW);
    const inter = liveOfCa({ id: 'platform-intermediate-ca', kind: 'ca' }, certs, NOW);
    expect(root?.subject).toContain('Root CA');
    expect(root?.notAfter.slice(0, 10)).toBe('2036-11-04');
    expect(inter?.subject).toContain('Intermediate CA');
    expect(inter?.daysLeft).toBe(36);
    expect(wantsIntermediate({ id: 'x', kind: 'ca', probe: 'configmap:pki-oneke/step-ca-certs/intermediate_ca.crt' })).toBe(true);
  });

  it('is undefined when the bundle has no such certificate', () => {
    expect(liveOfCa({ id: 'platform-intermediate-ca', kind: 'ca' }, [certs[0]], NOW)).toBeUndefined();
  });

  it('reads the active signing key of the realm', () => {
    const live = liveOfRealmKeys(
      {
        keys: [
          { algorithm: 'HS512', type: 'OCT', use: 'SIG', status: 'ACTIVE' },
          { algorithm: 'RSA-OAEP', type: 'RSA', use: 'ENC', status: 'ACTIVE', certificate: 'x' },
          { algorithm: 'RS256', type: 'RSA', use: 'SIG', status: 'ACTIVE', providerPriority: 100, certificate: kcCert },
        ],
      },
      NOW,
    );
    expect(live?.subject).toBe('CN=refresquito');
    expect(live?.notAfter.slice(0, 10)).toBe('2036-11-04');
    expect(liveOfRealmKeys({ keys: [] })).toBeUndefined();
  });
});
