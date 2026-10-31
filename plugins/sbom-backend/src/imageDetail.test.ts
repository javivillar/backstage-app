import { ImageDetailService, findingsOf, provenanceOf, statementOf } from './imageDetail';
import { RegistryClient, RegistryError } from './registry';

const HARBOR = 'https://harbor.example.io';
const ARTS = '/api/v2.0/projects/common/repositories/postgres/artifacts';
const INDEX = 'sha256:index';
const AMD = 'sha256:amd';
const ARM = 'sha256:arm';

// shapes of the live Harbor (2026-10-31): an index with two platforms, its scan report naming the digest of each
const artifacts = [
  {
    digest: INDEX,
    push_time: '2026-10-31T16:34:23Z',
    tags: [{ name: '18-alpine3.24' }],
    references: [
      { child_digest: AMD, platform: { os: 'linux', architecture: 'amd64' } },
      { child_digest: ARM, platform: { os: 'linux', architecture: 'arm64' } },
    ],
    scan_overview: { r: { scan_status: 'Success', summary: { summary: { Critical: 1, High: 1 } } } },
  },
  { digest: 'sha256:old', push_time: '2026-10-28T11:00:00Z', tags: null, scan_overview: null },
];
const report = {
  'application/vnd.security.vulnerability.report; version=1.1': {
    generated_at: '2026-10-31T16:35:00Z',
    scanner: { name: 'Trivy', version: 'v0.75.0' },
    vulnerabilities: [
      { id: 'CVE-1', package: 'gawk', version: '5.2', severity: 'Critical', preferred_cvss: { score_v3: 9.1 }, artifact_digests: [AMD], links: ['https://x/CVE-1'] },
      { id: 'CVE-1', package: 'gawk', version: '5.2', severity: 'Critical', preferred_cvss: { score_v3: 9.1 }, artifact_digests: [ARM] },
      { id: 'CVE-2', package: 'zlib', version: '1.3', fix_version: '1.3.1', severity: 'High', preferred_cvss: { score_v3: 7.5 }, artifact_digests: [AMD] },
      { id: 'CVE-3', package: 'zlib', version: '1.3', severity: 'Low', artifact_digests: [AMD] },
    ],
  },
};

function harbor() {
  const routes: Record<string, unknown> = {
    [`${ARTS}?with_tag=true&with_scan_overview=true&page_size=100`]: artifacts,
    '/api/v2.0/projects?name=common': [{ name: 'common', cve_allowlist: { items: [{ cve_id: 'CVE-1' }], expires_at: 1794021406 } }],
    [`${ARTS}/${encodeURIComponent(INDEX)}/additions/vulnerabilities`]: report,
  };
  return jest.fn(async (url: string) => {
    const path = url.slice(HARBOR.length);
    return path in routes ? new Response(JSON.stringify(routes[path])) : new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
}

function registry() {
  const r = Object.create(RegistryClient.prototype) as RegistryClient;
  r.referrers = jest.fn(async (_ref, digest: string, type: string) => {
    if (type.includes('cosign')) return digest === INDEX ? [{ mediaType: 'm', digest: 'sha256:sig', size: 1, artifactType: type }] : [];
    if (digest !== AMD) return [];
    return [
      { mediaType: 'm', digest: 'sha256:bom', size: 1, annotations: { 'in-toto.io/predicate-type': 'https://cyclonedx.org/bom/v1.6' } },
      { mediaType: 'm', digest: 'sha256:prov', size: 1, annotations: { 'in-toto.io/predicate-type': 'https://slsa.dev/provenance/v1' } },
    ];
  });
  r.manifest = jest.fn(async (_ref, digest: string) => ({ layers: [{ mediaType: 'application/vnd.in-toto+json', digest: `${digest}-layer`, size: 1 }] }));
  r.blob = jest.fn(async (_ref, digest: string) => {
    if (digest.startsWith('sha256:bom')) {
      return Buffer.from(JSON.stringify({
        predicateType: 'https://cyclonedx.org/bom/v1.6',
        predicate: { bomFormat: 'CycloneDX', specVersion: '1.6', components: [{ name: 'zlib', version: '1.3', purl: 'pkg:apk/alpine/zlib@1.3', licenses: [{ license: { id: 'Zlib' } }] }] },
      }));
    }
    return Buffer.from(JSON.stringify({
      predicateType: 'https://slsa.dev/provenance/v1',
      predicate: {
        buildDefinition: { buildType: 'buildkit' },
        runDetails: { builder: { id: 'https://github.com/x/runs/1' }, metadata: { startedOn: 's', finishedOn: 'f', buildkit_metadata: { vcs: { source: 'https://github.com/x', revision: 'abc' } } } },
      },
    }));
  });
  return r;
}

describe('image detail', () => {
  it('reads findings, VEX coverage, SBOM, provenance, signature and history of a tag', async () => {
    const d = await new ImageDetailService(HARBOR, ['common'], registry(), harbor()).detail('common/postgres', '18-alpine3.24');
    expect(d.digest).toBe(INDEX);
    expect(d.platforms.map(p => p.platform)).toEqual(['linux/amd64', 'linux/arm64']);
    expect(d.scan).toEqual({ status: 'Success', scanner: 'Trivy v0.75.0', generatedAt: '2026-10-31T16:35:00Z' });
    expect(d.findings.map(f => [f.id, f.severity, f.coveredByVex, f.platforms.join(',')])).toEqual([
      ['CVE-1', 'Critical', true, 'linux/amd64,linux/arm64'],
      ['CVE-2', 'High', false, 'linux/amd64'],
      ['CVE-3', 'Low', false, 'linux/amd64'],
    ]);
    expect(d.allowlist.count).toBe(1);
    expect(d.signatureAttached).toBe(true);
    expect(d.attestations.map(a => a.predicateType)).toEqual(['https://cyclonedx.org/bom/v1.6', 'https://slsa.dev/provenance/v1']);
    expect(d.sbom).toMatchObject({ total: 1, ecosystems: { apk: 1 }, licenses: { Zlib: 1 } });
    expect(d.provenance).toMatchObject({ builder: 'https://github.com/x/runs/1', source: 'https://github.com/x', revision: 'abc' });
    expect(d.history.map(h => [h.digest, h.tags, h.critical])).toEqual([[INDEX, ['18-alpine3.24'], 1], ['sha256:old', [], 0]]);
    expect(d.errors).toEqual([]);
  });

  it('refuses repositories outside the catalog, bad tags and tags not in Harbor', async () => {
    const svc = new ImageDetailService(HARBOR, ['common'], registry(), harbor());
    await expect(svc.detail('app-secret/x', '1')).rejects.toMatchObject({ status: 400 });
    await expect(svc.detail('common/postgres', '../x')).rejects.toMatchObject({ status: 400 });
    await expect(svc.detail('common/postgres', '99')).rejects.toBeInstanceOf(RegistryError);
  });

  it('keeps going when the attestations cannot be read', async () => {
    const r = registry();
    r.referrers = jest.fn(async () => {
      throw new RegistryError('down', 502);
    });
    const d = await new ImageDetailService(HARBOR, ['common'], r, harbor()).detail('common/postgres', '18-alpine3.24');
    expect(d.findings).toHaveLength(3);
    expect(d.sbom).toBeNull();
    expect(d.errors.join(' ')).toMatch(/signature: down.*attestations: down/);
  });

  it('parses statements in a DSSE envelope and provenance v0.2', () => {
    const inner = { predicateType: 'p', predicate: { a: 1 } };
    expect(statementOf(JSON.stringify({ payload: Buffer.from(JSON.stringify(inner)).toString('base64') }))).toEqual(inner);
    expect(provenanceOf('v0.2', { builder: { id: 'b' }, buildType: 't', metadata: { buildStartedOn: 's' } })).toMatchObject({ builder: 'b', buildType: 't', startedOn: 's' });
    expect(findingsOf(undefined, new Set(), new Map())).toEqual([]);
  });
});
