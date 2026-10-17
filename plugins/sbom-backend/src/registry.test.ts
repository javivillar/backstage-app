import { RegistryClient, credentialsFromDockerConfig, findSbom, parseImageRef } from './registry';
import { summarize } from './cyclonedx';

const BOM = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  metadata: { timestamp: '2026-10-17T00:00:00Z', tools: { components: [{ name: 'syft', version: '1.18.1' }] } },
  components: [
    { type: 'library', name: 'refresquito-fastapi', version: '3.1.0', purl: 'pkg:pypi/refresquito-fastapi@3.1.0',
      licenses: [{ expression: 'LicenseRef-Refresquito-Proprietary' }] },
    { type: 'library', name: 'fastapi', version: '0.143.3', purl: 'pkg:pypi/fastapi@0.143.3', licenses: [{ license: { id: 'MIT' } }] },
    { type: 'library', name: 'libc6', version: '2.36', purl: 'pkg:deb/debian/libc6@2.36' },
    { type: 'file', name: '/usr/lib/x.so' },
  ],
};
const IMAGE = 'sha256:' + 'a'.repeat(64);
const SBOM_MANIFEST = 'sha256:' + 'b'.repeat(64);
const LAYER = 'sha256:' + 'c'.repeat(64);

/** A registry in memory: a bearer challenge, then the manifests and blobs of one repository. */
function registry({ referrersApi }: { referrersApi: boolean }) {
  const calls: string[] = [];
  const index = {
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [
      { mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: SBOM_MANIFEST, size: 1, artifactType: 'application/vnd.cyclonedx+json',
        annotations: { 'org.opencontainers.image.created': '2026-10-17T00:00:00Z', 'org.opencontainers.image.revision': 'abc123' } },
      { mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: 'sha256:' + 'd'.repeat(64), size: 1, artifactType: 'application/vnd.other' },
    ],
  };
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';
    calls.push(`${url} ${auth.split(' ')[0]}`);
    const json = (body: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
    if (url.startsWith('https://ghcr.io/token')) {
      return auth === `Basic ${Buffer.from('bot:secret').toString('base64')}` ? json({ token: 'T' }) : new Response('', { status: 401 });
    }
    if (auth !== 'Bearer T') {
      return new Response('', { status: 401, headers: { 'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:owner/app-api:pull"' } });
    }
    const path = url.replace('https://ghcr.io/v2/owner/app-api', '');
    if (path === '/manifests/abc123') return json({}, { 'docker-content-digest': IMAGE });
    if (path.startsWith(`/referrers/${IMAGE}`)) return referrersApi ? json(index) : new Response('', { status: 404 });
    if (path === `/manifests/${IMAGE.replace(':', '-')}`) return referrersApi ? new Response('', { status: 404 }) : json(index);
    if (path === `/manifests/${SBOM_MANIFEST}`) return json({ layers: [{ mediaType: 'application/vnd.cyclonedx+json', digest: LAYER, size: 1 }] });
    if (path === `/blobs/${LAYER}`) return json(BOM);
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const creds = () => ({ username: 'bot', password: 'secret' });

describe('parseImageRef', () => {
  it('reads tags and digests, and wants a registry host', () => {
    expect(parseImageRef('ghcr.io/owner/app-api:abc123')).toEqual({ host: 'ghcr.io', repository: 'owner/app-api', reference: 'abc123' });
    expect(parseImageRef(`localhost:5000/app@${IMAGE}`)).toEqual({ host: 'localhost:5000', repository: 'app', reference: IMAGE });
    expect(() => parseImageRef('owner/app:1')).toThrow(/registry/);
    expect(() => parseImageRef('ghcr.io/owner/app:../x')).toThrow(/valid/);
  });
});

describe('credentialsFromDockerConfig', () => {
  it('takes the auth of the host', () => {
    const json = JSON.stringify({ auths: { 'ghcr.io': { auth: Buffer.from('bot:secret').toString('base64') } } });
    expect(credentialsFromDockerConfig(json, 'ghcr.io')).toEqual({ username: 'bot', password: 'secret' });
    expect(credentialsFromDockerConfig(json, 'quay.io')).toBeUndefined();
    expect(credentialsFromDockerConfig(undefined, 'ghcr.io')).toBeUndefined();
  });
});

describe('findSbom', () => {
  it.each([true, false])('finds the SBOM attached to the tag (referrers API: %s)', async referrersApi => {
    const { fetchImpl, calls } = registry({ referrersApi });
    const found = await findSbom(new RegistryClient(creds, fetchImpl), 'ghcr.io/owner/app-api:abc123');
    expect(found).toMatchObject({ digest: IMAGE, sbomDigest: SBOM_MANIFEST, revision: 'abc123', created: '2026-10-17T00:00:00Z' });
    expect(summarize(found!.bom).total).toBe(3);
    // one token for the repository, asked for once
    expect(calls.filter(c => c.startsWith('https://ghcr.io/token'))).toHaveLength(1);
  });

  it('says there is none when nothing refers to the image', async () => {
    const { fetchImpl } = registry({ referrersApi: false });
    const client = new RegistryClient(creds, ((url: string, init?: RequestInit) =>
      String(url).includes('sha256-') ? Promise.resolve(new Response('', { status: 404 })) : fetchImpl(url, init)) as typeof fetch);
    expect(await findSbom(client, 'ghcr.io/owner/app-api:abc123')).toBeUndefined();
  });

  it('tells when the registry refuses the credentials', async () => {
    const { fetchImpl } = registry({ referrersApi: true });
    const client = new RegistryClient(() => ({ username: 'bot', password: 'wrong' }), fetchImpl);
    await expect(findSbom(client, 'ghcr.io/owner/app-api:abc123')).rejects.toThrow(/refused a token/);
  });
});

describe('summarize', () => {
  it('lists the components by ecosystem, with the frameworks apart', () => {
    const s = summarize(BOM);
    expect(s.ecosystems).toEqual({ deb: 1, pypi: 2 });
    expect(s.frameworks.map(c => `${c.name} ${c.version}`)).toEqual(['refresquito-fastapi 3.1.0']);
    expect(s.licenses).toEqual({ '(none)': 1, MIT: 1, 'LicenseRef-Refresquito-Proprietary': 1 });
    expect(s.generator).toBe('syft 1.18.1');
    expect(() => summarize({ bomFormat: 'SPDX' })).toThrow(/CycloneDX/);
  });
});
