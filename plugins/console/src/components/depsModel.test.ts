import type { Entity } from '@backstage/catalog-model';
import { buildGraph, catalogueCategory, inStack, layerAmong, layerOf, matchesCatalogue, reach, stackLayout, topApplications, treeOf } from './depsModel';

const c = (name: string, extra: Partial<Entity['metadata']> = {}, relations: Entity['relations'] = []): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name, namespace: 'default', ...extra },
  spec: { type: 'service' },
  relations,
});

describe('depsModel', () => {
  const petstore = c('petstore-oneke', { annotations: { 'refresquito.io/application': 'petstore' } }, [
    { type: 'dependsOn', targetRef: 'component:default/iam-oneke' },
    { type: 'consumesApi', targetRef: 'api:default/orders' },
  ]);
  const iam = c('iam-oneke', { labels: { 'refresquito.io/segment': 'iam' } });
  const orders = c('orders-oneke', { annotations: { 'refresquito.io/application': 'orders' } }, [{ type: 'providesApi', targetRef: 'api:default/orders' }]);
  const graph = buildGraph([petstore, iam, orders], () => ({ tone: 'ok', label: 'Healthy' }));

  it('puts each element in its layer', () => {
    expect(layerOf(petstore)).toBe('biz');
    expect(layerOf(iam)).toBe('sec');
    expect(layerOf(c('gravitee-oneke'))).toBe('dat');
    expect(layerOf(c('something', { labels: { 'refresquito.io/segment': 'observability' } }))).toBe('obs');
  });

  it('gives business and development services their bands, with the old catalog too', () => {
    const sys: Entity = { apiVersion: 'backstage.io/v1alpha1', kind: 'System', metadata: { name: 'petstore', namespace: 'default' }, spec: { type: 'business-service' } };
    expect(layerOf(sys)).toBe('biz');
    expect(layerOf({ ...c('python-framework-3-2'), spec: { type: 'framework-line' } })).toBe('fwk');
    expect(layerOf({ ...c('python-framework'), spec: { type: 'library', system: 'framework-development' } })).toBe('fwk');
    expect(layerOf({ ...c('iam-oneke'), spec: { type: 'platform-service', system: 'iam' } })).toBe('sec');
  });

  it('links a business service to its application and the application to its instances', () => {
    const sys: Entity = { apiVersion: 'backstage.io/v1alpha1', kind: 'System', metadata: { name: 'petstore', namespace: 'default' }, spec: { type: 'business-service' }, relations: [{ type: 'hasPart', targetRef: 'component:default/petstore' }, { type: 'hasPart', targetRef: 'component:default/petstore-oneke' }] };
    const repo: Entity = { ...c('petstore', {}, [{ type: 'hasSubcomponent', targetRef: 'component:default/petstore-oneke' }]), spec: { type: 'business-application' } };
    const segment: Entity = { apiVersion: 'backstage.io/v1alpha1', kind: 'System', metadata: { name: 'iam', namespace: 'default' }, spec: { type: 'network-segment' } };
    const g = buildGraph([sys, repo, petstore, segment], () => ({ tone: 'ok', label: 'Healthy' }));
    expect(g.nodes.map(n => n.id)).toEqual(['system:default/petstore', 'component:default/petstore', 'component:default/petstore-oneke']);
    expect(g.links.map(l => `${l.source}>${l.target}:${l.label}`)).toEqual([
      'system:default/petstore>component:default/petstore:application',
      'component:default/petstore>component:default/petstore-oneke:instance',
    ]);
  });

  it('links dependsOn and the APIs consumed to their provider, and counts dependents', () => {
    expect(graph.links).toEqual([
      { source: 'component:default/petstore-oneke', target: 'component:default/iam-oneke', label: 'depends on', type: 'dep' },
      { source: 'component:default/petstore-oneke', target: 'component:default/orders-oneke', label: 'orders API', type: 'api' },
    ]);
    expect(graph.nodes.find(n => n.id === 'component:default/iam-oneke')?.deg).toBe(1);
  });

  it('reaches downstream only when asked', () => {
    expect([...reach('component:default/iam-oneke', graph.links, 99, true).keys()]).toEqual(['component:default/iam-oneke']);
    expect(reach('component:default/iam-oneke', graph.links, 99, false).has('component:default/orders-oneke')).toBe(true);
  });

  it('places every node on the height of its layer', () => {
    const pos = stackLayout(graph.nodes, graph.links);
    expect(pos.get('component:default/petstore-oneke')!.y).toBe(pos.get('component:default/orders-oneke')!.y);
    expect(pos.get('component:default/iam-oneke')!.y).toBeGreaterThan(pos.get('component:default/petstore-oneke')!.y);
  });
});

describe('the layer of a Refresquito service', () => {
  const svc = (name: string, extra: Partial<Entity['metadata']> = {}, spec: Entity['spec'] = { type: 'platform-service' }): Entity => ({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name, labels: { 'refresquito.io/segment': 'platform' }, ...extra },
    spec,
  });
  it('the declared layer wins over the name and the segment', () => {
    expect(layerOf(svc('observability-oneke', { annotations: { 'refresquito.io/layer': 'ops' } }))).toBe('ops');
    expect(layerOf(svc('x', { annotations: { 'refresquito.io/layer': 'nonsense' } }))).toBe('ops');
  });
  it('by name when it says nothing: the ones that fell into infrastructure', () => {
    const by = (name: string) => layerOf(svc(name));
    expect(['cnoe-oneke', 'continuity-oneke', 'headlamp-oneke', 'console-vms-oneke', 'opsassistant-oneke'].map(by)).toEqual(['ops', 'ops', 'ops', 'ops', 'ops']);
    expect(['events-oneke', 'activepieces-oneke', 'datahub-oneke'].map(by)).toEqual(['dat', 'dat', 'dat']);
    expect(['misp-oneke', 'intelmq-oneke', 'pki-oneke', 'secassistant-oneke', 'iam-oneke'].map(by)).toEqual(['sec', 'sec', 'sec', 'sec', 'sec']);
    expect(['functionalassistant-oneke', 'harbor'].map(by)).toEqual(['dev', 'dev']);
    expect(['nodes-oneke', 'segments-oneke', 'longhorn'].map(by)).toEqual(['inf', 'inf', 'inf']);
    expect(['operaton-oneke', 'whisker-oneke'].map(by)).toEqual(['app', 'obs']);
  });
  it('a database is data', () => {
    const db: Entity = { apiVersion: 'backstage.io/v1alpha1', kind: 'Resource', metadata: { name: 'petstore-database', annotations: { 'refresquito.io/application': 'petstore' } }, spec: { type: 'database' } };
    expect(layerOf(db)).toBe('dat');
  });
  it('the category of the catalogue: business, a band, or the development services', () => {
    expect(catalogueCategory(svc('iam-oneke', { annotations: { 'refresquito.io/layer': 'sec' } }))).toBe('sec');
    expect(catalogueCategory(svc('python-framework-3-3', {}, { type: 'framework-line' }))).toBe('fwk');
    expect(catalogueCategory({ ...svc('petstore-oneke', { annotations: { 'refresquito.io/application': 'petstore' } }), spec: { type: 'application-instance' } })).toBe('business');
    expect(catalogueCategory({ apiVersion: 'backstage.io/v1alpha1', kind: 'API', metadata: { name: 'x' }, spec: { type: 'openapi' } })).toBeUndefined();
  });
});

describe('the layer of a block resource', () => {
  const comp = (name: string, layer: string): Entity => ({ apiVersion: 'backstage.io/v1alpha1', kind: 'Component', metadata: { name, namespace: 'default', annotations: { 'refresquito.io/layer': layer } }, spec: { type: 'platform-service' } });
  const res = (name: string, type: string, extra: Partial<Entity> = {}): Entity => ({ apiVersion: 'backstage.io/v1alpha1', kind: 'Resource', metadata: { name, namespace: 'default', annotations: { 'refresquito.io/application': 'petstore' } }, spec: { type }, ...extra });
  const byRef = new Map([comp('seaweedfs-oneke', 'dat'), comp('iam-oneke', 'sec'), comp('alfrescodms-oneke', 'app')].map(e => [`component:default/${e.metadata.name}`, e]));
  it('takes the layer of the service that provides it, or of the component it depends on', () => {
    const files = res('petstore-files', 's3-bucket');
    files.metadata.annotations!['refresquito.io/provided-by'] = 'seaweedfs-oneke';
    expect(layerAmong(files, byRef)).toBe('dat');
    expect(layerAmong(res('petstore-sso-client', 'sso-client', { relations: [{ type: 'dependsOn', targetRef: 'component:default/iam-oneke' }] }), byRef)).toBe('sec');
    expect(layerAmong(res('petstore-documents', 'dms-site', { relations: [{ type: 'dependsOn', targetRef: 'component:default/alfrescodms-oneke' }] }), byRef)).toBe('app');
  });
  it('a database stays data, a declared layer wins, nothing known: the name fallback', () => {
    expect(layerAmong(res('petstore-database', 'database', { relations: [{ type: 'dependsOn', targetRef: 'component:default/iam-oneke' }] }), byRef)).toBe('dat');
    const declared = res('x', 's3-bucket');
    declared.metadata.annotations!['refresquito.io/layer'] = 'obs';
    declared.metadata.annotations!['refresquito.io/provided-by'] = 'seaweedfs-oneke';
    expect(layerAmong(declared, byRef)).toBe('obs');
    expect(layerAmong(res('lonely', 's3-bucket'), byRef)).toBe(layerOf(res('lonely', 's3-bucket')));
  });
});

describe('Dependencies as the catalogue', () => {
  // made-up catalog: an application, its instance with a database and an SSO client, a service it uses through an
  // API, the storage under that service, an image and a business service
  const comp = (name: string, spec: Record<string, unknown>, relations: Entity['relations'] = [], annotations: Record<string, string> = {}): Entity => ({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name, namespace: 'default', annotations },
    spec,
    relations,
  });
  const res = (name: string, type: string, relations: Entity['relations'] = [], annotations: Record<string, string> = {}): Entity => ({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Resource',
    metadata: { name, namespace: 'default', annotations },
    spec: { type, owner: 'group:default/team-pets' },
    relations,
  });
  const shop = comp('shop', { type: 'service', system: 'business-systems', owner: 'team-pets' }, [
    { type: 'hasPart', targetRef: 'component:default/shop-oneke' },
  ]);
  const instance = comp('shop-oneke', { type: 'application-instance', owner: 'team-pets' }, [
    { type: 'partOf', targetRef: 'component:default/shop' },
    { type: 'dependsOn', targetRef: 'resource:default/shop-database' },
    { type: 'dependsOn', targetRef: 'resource:default/shop-sso-client' },
    { type: 'consumesApi', targetRef: 'api:default/files' },
  ], { 'refresquito.io/application': 'shop' });
  const db = res('shop-database', 'database', [], { 'refresquito.io/application': 'shop-oneke' });
  const sso = res('shop-sso-client', 'sso-client', [], { 'refresquito.io/application': 'shop', 'refresquito.io/provided-by': 'iam-oneke' });
  const iam = comp('iam-oneke', { type: 'platform-service', system: 'iam' });
  // a platform service that also uses the API of another application (as observability scrapes every one)
  const files = comp('files-oneke', { type: 'platform-service' }, [
    { type: 'providesApi', targetRef: 'api:default/files' },
    { type: 'dependsOn', targetRef: 'component:default/longhorn-oneke' },
    { type: 'consumesApi', targetRef: 'api:default/zoo' },
  ], { 'refresquito.io/layer': 'dat' });
  const zoo = comp('zoo-oneke', { type: 'application-instance' }, [
    { type: 'providesApi', targetRef: 'api:default/zoo' },
    { type: 'dependsOn', targetRef: 'resource:default/zoo-database' },
  ], { 'refresquito.io/application': 'zoo' });
  const zooDb: Entity = { ...res('zoo-database', 'database', [], { 'refresquito.io/application': 'zoo-oneke' }), spec: { type: 'database', owner: 'group:default/team-zoo' } };
  const longhorn = comp('longhorn-oneke', { type: 'platform-service' }, [], { 'refresquito.io/layer': 'inf' });
  const image = res('shop-image', 'container-image');
  const business: Entity = { apiVersion: 'backstage.io/v1alpha1', kind: 'System', metadata: { name: 'shop', namespace: 'default' }, spec: { type: 'business-service' } };
  const all = [shop, instance, db, sso, iam, files, longhorn, zoo, zooDb, image, business];
  const g = buildGraph(all, () => ({ tone: 'ok', label: 'Healthy' }), inStack);
  const ids = (xs: Iterable<string>) => [...xs].map(x => x.split('/')[1]).sort();

  it('draws what the catalogue lists and the Resources of the applications, not the images nor the Systems', () => {
    expect(ids(g.nodes.map(n => n.id))).toEqual(['files-oneke', 'iam-oneke', 'longhorn-oneke', 'shop', 'shop-database', 'shop-oneke', 'shop-sso-client', 'zoo-database', 'zoo-oneke']);
  });

  it('puts each Component in the band of the catalogue, a Resource in the layer of what provides it', () => {
    const layer = (name: string) => g.nodes.find(n => n.entity.metadata.name === name)?.layer;
    for (const e of [shop, iam, files, longhorn]) {
      const cat = catalogueCategory(e);
      expect(layer(e.metadata.name)).toBe(cat === 'business' ? 'biz' : cat);
    }
    expect(layer('shop-database')).toBe('dat');
    expect(layer('shop-sso-client')).toBe('sec');
  });

  it('takes a repository made of an application instance as a business application', () => {
    const repo = comp('petstore', { type: 'service', system: 'petstore' }, [{ type: 'hasPart', targetRef: 'component:default/petstore-oneke' }]);
    const inst = comp('petstore-oneke', { type: 'application-instance' });
    const byRef = new Map([repo, inst].map(e => [`component:default/${e.metadata.name}`, e]));
    expect(catalogueCategory(repo)).toBeUndefined();
    expect(catalogueCategory(repo, byRef)).toBe('business');
  });

  it('filters as the chips of the catalogue', () => {
    const pass = (f: Parameters<typeof matchesCatalogue>[1], mine = new Set<string>(), starred = new Set<string>()) =>
      ids(g.nodes.filter(n => matchesCatalogue(n, f, mine, starred)).map(n => n.id));
    expect(pass('business')).toEqual(['shop', 'shop-oneke', 'zoo-oneke']);
    expect(pass('inf')).toEqual(['longhorn-oneke']);
    expect(pass('mine', new Set(['group:default/team-pets']))).toEqual(['shop', 'shop-database', 'shop-oneke', 'shop-sso-client']);
    expect(pass('favourites', new Set(), new Set(['component:default/iam-oneke']))).toEqual(['iam-oneke']);
    expect(pass('all')).toHaveLength(9);
  });

  it('offers the applications, not their instances, and gives the whole tree under one, not going into another', () => {
    expect(topApplications(g.nodes).map(n => n.entity.metadata.name)).toEqual(['shop', 'zoo-oneke']);
    expect(ids(treeOf('component:default/shop', g.links, g.nodes))).toEqual(['files-oneke', 'longhorn-oneke', 'shop', 'shop-database', 'shop-oneke', 'shop-sso-client']);
    expect(g.links.find(l => l.source === 'component:default/shop')?.label).toBe('instance');
  });
});
