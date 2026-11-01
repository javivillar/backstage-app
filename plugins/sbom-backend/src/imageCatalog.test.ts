import { ImageCatalogService, IMAGE_CATALOG_SCHEMA, annotationsOf, scanOf } from './imageCatalog';
import { entitiesOf, entityNameOf } from './imageCatalogEntities';
import { RegistryClient, RegistryError } from './registry';
import { EntityPolicies, FieldFormatEntityPolicy, NoForeignRootFieldsEntityPolicy, SchemaValidEntityPolicy } from '@backstage/catalog-model';
// GET .../projects/common/repositories/postgres/artifacts?with_tag=true&with_scan_overview=true of the live Harbor
// (2026-10-31): tags 17-alpine3.24 and 16-alpine3.24 of dhi.io/postgres with their DHI annotations and Trivy scan
import postgresArtifacts from './__fixtures__/harbor-postgres-artifacts.json';

const HARBOR = 'https://harbor.example.io';

const catalogDoc = {
  schema: IMAGE_CATALOG_SCHEMA,
  generatedAt: '2026-10-31T10:00:00Z',
  catalogCommit: 'abc1234',
  categories: { database: 'Databases' },
  images: [
    {
      project: 'common',
      name: 'postgres',
      repository: 'common/postgres',
      source: 'dhi.io/postgres',
      tags: [
        {
          tag: '17-alpine3.24', category: 'database', summary: 'PostgreSQL 17.', audience: 'apps', state: 'approved',
          replacedBy: '', owner: 'platform-team', eol: '', license: '', note: 'n', synced: true, digest: 'sha256:x',
          sourceSignatureVerified: true, signatures: ['signature', 'refresquito'], refresquitoSigned: true,
          platforms: [
            { platform: 'linux/amd64', digest: 'sha256:a', attestations: ['vex', 'sbom-spdx'] },
            { platform: 'linux/arm64', digest: 'sha256:b', attestations: ['sbom-spdx', 'provenance'] },
          ],
        },
        {
          tag: '16-alpine3.24', category: 'database', summary: 'PostgreSQL 16.', audience: 'apps', state: 'deprecated',
          replacedBy: 'common/postgres:17-alpine3.24', owner: 'platform-team', eol: '2026-12-31', license: 'X-1.0',
          note: '', synced: false,
          quarantine: { digest: 'sha256:new16', reasons: ['postgres:16-alpine3.24 (linux/amd64) CVE-1 zlib Critical (no VEX statement)'] },
        },
      ],
    },
    { project: 'app-secret', name: 'x', repository: 'app-secret/x', source: '', tags: [] },
  ],
  supplyChain: { airgapped: false, vulnerabilityDb: { updatedAt: '2026-11-01T01:13:06Z', source: 'online' }, lastBundle: null },
};

function harborApi(extra: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    '/api/v2.0/projects?name=common': [{ name: 'common', project_id: 9 }],
    '/api/v2.0/projects?name=framework-python': [{ name: 'framework-python', project_id: 10 }],
    '/api/v2.0/projects?name=framework-spring': [],
    '/api/v2.0/projects/common/repositories/postgres/artifacts?with_tag=true&with_scan_overview=true&page_size=100': postgresArtifacts,
    ...extra,
  };
  return jest.fn(async (url: string) => {
    const path = url.slice(HARBOR.length);
    if (!(path in routes)) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(routes[path]), { status: 200 });
  }) as unknown as typeof fetch;
}

function registry(catalog: unknown | 'missing') {
  const r = Object.create(RegistryClient.prototype) as RegistryClient;
  r.resolve = jest.fn(async () => {
    if (catalog === 'missing') throw new RegistryError('not there', 404);
    return 'sha256:m';
  });
  r.manifest = jest.fn(async () => ({ layers: [{ mediaType: 'application/json', digest: 'sha256:l', size: 1 }] }));
  r.blob = jest.fn(async () => Buffer.from(JSON.stringify(catalog)));
  return r;
}

describe('image catalog', () => {
  it('merges the published catalog with what Harbor says of each tag', async () => {
    const svc = new ImageCatalogService({ harborUrl: HARBOR, projects: ['common', 'framework-python', 'framework-spring'] }, registry(catalogDoc), harborApi());
    const view = await svc.view();
    expect(view.catalog).toEqual({ published: true, generatedAt: '2026-10-31T10:00:00Z', commit: 'abc1234' });
    expect(view.images.map(i => i.repository)).toEqual(['common/postgres']);   // other projects are not shown
    const [img] = view.images;
    expect(img.harborUrl).toBe(`${HARBOR}/harbor/projects/9/repositories/postgres/artifacts-tab`);
    const [t17, t16] = img.tags;
    expect(t17).toMatchObject({
      tag: '17-alpine3.24', pull: 'harbor.example.io/common/postgres:17-alpine3.24', audience: 'apps', inHarbor: true,
      license: 'PostgreSQL', distro: 'alpine-3.24', compliance: 'cis', sourceSignatureVerified: true,
      attestations: ['provenance', 'sbom-spdx', 'vex'],
    });
    expect(t17.version).toMatch(/^17\./);
    expect(t17.eol).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(t17.scan?.status).toBe('Success');
    // the catalog overrides license and end of life when it gives them
    expect(t16).toMatchObject({ state: 'deprecated', replacedBy: 'common/postgres:17-alpine3.24', license: 'X-1.0', eol: '2026-12-31' });
    expect(view.errors).toEqual([]);
    // what the quarantine and the signature of Refresquito say, and the facts of the supply chain
    expect(t17.refresquitoSigned).toBe(true);
    expect(t16).toMatchObject({ refresquitoSigned: false, quarantine: { digest: 'sha256:new16' } });
    expect(view.supplyChain?.vulnerabilityDb?.updatedAt).toBe('2026-11-01T01:13:06Z');
  });

  it('without a published catalog, lists the repositories of Harbor (not the catalog artifact itself)', async () => {
    const fetchImpl = harborApi({
      '/api/v2.0/projects/common/repositories?page_size=100': [{ name: 'common/postgres' }, { name: 'common/image-catalog' }],
      '/api/v2.0/projects/framework-python/repositories?page_size=100': [],
    });
    const view = await new ImageCatalogService({ harborUrl: HARBOR, projects: ['common', 'framework-python'] }, registry('missing'), fetchImpl).view();
    expect(view.catalog).toEqual({ published: false, error: undefined });
    expect(view.images.map(i => i.repository)).toEqual(['common/postgres']);
    expect(view.images[0].tags.map(t => [t.tag, t.category, t.audience])).toEqual([
      ['16-alpine3.24', 'uncategorised', 'unknown'],
      ['17-alpine3.24', 'uncategorised', 'unknown'],
    ]);
  });

  it('caches the view', async () => {
    const fetchImpl = harborApi();
    const svc = new ImageCatalogService({ harborUrl: HARBOR, projects: ['common'] }, registry(catalogDoc), fetchImpl);
    await svc.view();
    const calls = (fetchImpl as unknown as jest.Mock).mock.calls.length;
    await svc.view();
    expect((fetchImpl as unknown as jest.Mock).mock.calls.length).toBe(calls);
  });

  it('reports a catalog of another schema as an error and still lists Harbor', async () => {
    const fetchImpl = harborApi({ '/api/v2.0/projects/common/repositories?page_size=100': [{ name: 'common/postgres' }] });
    const view = await new ImageCatalogService({ harborUrl: HARBOR, projects: ['common'] }, registry({ schema: 'other' }), fetchImpl).view();
    expect(view.catalog?.published).toBe(false);
    expect(view.errors[0]).toMatch(/not refresquito.image-catalog\/v1/);
    expect(view.images).toHaveLength(1);
  });

  it('reads scan and annotations of a Harbor artifact', () => {
    const a = postgresArtifacts[0] as Parameters<typeof scanOf>[0];
    expect(scanOf(a)).toMatchObject({ status: 'Success' });
    expect(annotationsOf({ digest: 'd', annotations: null })).toEqual({ version: '', title: '', license: '', eol: '', distro: '', compliance: '' });
  });

  it('makes one System and one Resource per repository', async () => {
    const view = await new ImageCatalogService({ harborUrl: HARBOR, projects: ['common'] }, registry(catalogDoc), harborApi()).view();
    const [system, harbor, res] = entitiesOf(view, 'https://backstage.example.io/');
    // the element of the alerts of the images in support (a Component with refresquito.io/namespace)
    expect(harbor).toMatchObject({
      kind: 'Component',
      metadata: { name: 'harbor', annotations: { 'refresquito.io/namespace': 'harbor' } },
      spec: { type: 'service', owner: 'platform-team', system: 'image-catalog' },
    });
    expect(system).toMatchObject({ kind: 'System', metadata: { name: 'image-catalog' } });
    expect(res).toMatchObject({
      kind: 'Resource',
      metadata: { name: 'image-common-postgres', title: 'common/postgres', description: 'PostgreSQL 17.', tags: ['database', 'apps', 'common'] },
      spec: { type: 'container-image', owner: 'platform-team', lifecycle: 'production', system: 'image-catalog' },
    });
    expect(res.metadata.annotations?.['refresquito.io/harbor-repository']).toBe('common/postgres');
    // the catalog refuses relative URLs in links (2026-10-31: every image entity failed its policy check)
    expect(system.metadata.links?.[0].url).toBe('https://backstage.example.io/images');
    expect(res.metadata.links?.map(l => l.url)).toEqual([
      'https://backstage.example.io/images?repository=common%2Fpostgres',
      `${HARBOR}/harbor/projects/9/repositories/postgres/artifacts-tab`,
    ]);
    expect(res.metadata.annotations?.['backstage.io/managed-by-location']).toBe(`url:${HARBOR}/common/image-catalog`);
    // the policies the catalog applies before accepting an entity
    const policy = EntityPolicies.allOf([new SchemaValidEntityPolicy(), new FieldFormatEntityPolicy(), new NoForeignRootFieldsEntityPolicy()]);
    for (const e of [system, harbor, res]) await expect(policy.enforce(e)).resolves.toBeDefined();
    expect(entityNameOf('framework-spring/eclipse-temurin')).toBe('image-framework-spring-eclipse-temurin');
    expect(entityNameOf(`common/${'x'.repeat(80)}`)).toHaveLength(63);
  });
});
