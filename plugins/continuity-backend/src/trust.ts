import { X509Certificate } from 'crypto';
import type { LiveCert, TrustAnchor } from './types';

const DAY = 86_400_000;
const PEM = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/** The certificates of a PEM bundle (platform-ca.pem: root + intermediate CA of the platform). Bad blocks are skipped. */
export function parseBundle(pem: string): X509Certificate[] {
  const out: X509Certificate[] = [];
  for (const block of pem.match(PEM) ?? []) {
    try {
      out.push(new X509Certificate(block));
    } catch {
      /* not a certificate: skipped */
    }
  }
  return out;
}

/** Self-signed: issued by itself and signed with its own key (a root CA). */
export function isSelfSigned(c: X509Certificate): boolean {
  if (c.subject !== c.issuer) return false;
  try {
    return c.verify(c.publicKey);
  } catch {
    return false;
  }
}

export function liveOf(c: X509Certificate, now = Date.now()): LiveCert {
  const notAfter = new Date(c.validTo);
  return {
    notAfter: notAfter.toISOString(),
    notBefore: new Date(c.validFrom).toISOString(),
    subject: c.subject.replace(/\n/g, ', '),
    daysLeft: Math.floor((notAfter.getTime() - now) / DAY),
  };
}

/** Whether an anchor of kind ca means the intermediate CA (its probe, id or title says so); otherwise the root. */
export const wantsIntermediate = (a: TrustAnchor) => /intermediate/i.test(`${a.probe ?? ''} ${a.id} ${a.title ?? ''}`);

/**
 * The live certificate of a trust anchor of kind ca, from the platform bundle: the self-signed one for the root, the
 * one that is not for the intermediate. undefined when the bundle has no such certificate.
 */
export function liveOfCa(a: TrustAnchor, certs: X509Certificate[], now = Date.now()): LiveCert | undefined {
  const inter = wantsIntermediate(a);
  const c = certs.find(x => isSelfSigned(x) !== inter);
  return c && liveOf(c, now);
}

/** The probe asks for the keys of the Keycloak realm (keycloak:realm-keys, or kind realm-keys without probe). */
export const isKeycloakProbe = (a: TrustAnchor) => a.probe === 'keycloak:realm-keys' || (!a.probe && a.kind === 'realm-keys');

type KeycloakKey = { algorithm?: string; type?: string; use?: string; status?: string; certificate?: string; providerPriority?: number };

/**
 * The live certificate of the realm's signing key, from GET /admin/realms/<realm>/keys: the active RS256 signature
 * key with the highest priority (the one that signs the tokens), its certificate given as base64 DER.
 */
export function liveOfRealmKeys(body: unknown, now = Date.now()): LiveCert | undefined {
  const keys = ((body as { keys?: KeycloakKey[] })?.keys ?? []).filter(k => k.certificate && (k.use ?? 'SIG') === 'SIG' && (k.status ?? 'ACTIVE') === 'ACTIVE');
  const best = keys.sort((a, b) => Number(b.algorithm === 'RS256') - Number(a.algorithm === 'RS256') || (b.providerPriority ?? 0) - (a.providerPriority ?? 0))[0];
  if (!best?.certificate) return undefined;
  return liveOf(new X509Certificate(Buffer.from(best.certificate, 'base64')), now);
}
