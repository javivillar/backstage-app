import type { Entity } from '@backstage/catalog-model';
import { appOf, ARCH_BANDS, clusterBands, monogram } from './clusterArchModel';

const component = (name: string, more: { type?: string; annotations?: Record<string, string>; labels?: Record<string, string>; title?: string } = {}): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name, namespace: 'default', title: more.title, annotations: more.annotations, labels: more.labels },
  spec: { type: more.type ?? 'platform-service' },
});
const app = (name: string, health = 'Healthy', sync = 'Synced', namespace?: string) => ({ name, health, sync, namespace, autosync: true });

describe('the architecture of the cluster by catalogue bands', () => {
  const entities = [
    component('iam-oneke', { annotations: { 'refresquito.io/namespace': 'nato-sirtap-iam-oneke', 'refresquito.io/product': 'Keycloak 26.5' } }),
    component('wazuh-oneke', { annotations: { 'refresquito.io/namespace': 'nato-sirtap-wazuh-oneke' } }),
    component('misp-oneke', { annotations: { 'refresquito.io/namespace': 'nato-sirtap-misp-oneke', 'refresquito.io/suspended': 'true', 'refresquito.io/layer': 'sec' } }),
    component('datahub-oneke', {}),
    component('segments-oneke', {}),
    component('petstore', { type: 'application-instance', annotations: { 'refresquito.io/namespace': 'nato-sirtap-petstore', 'refresquito.io/stage': 'pro', 'refresquito.io/application': 'petstore' } }),
    component('python-framework', { type: 'development-service', title: 'Python Framework' }),
    component('something', { type: 'library' }),
    { apiVersion: 'backstage.io/v1alpha1', kind: 'API', metadata: { name: 'petstore-api' }, spec: { type: 'openapi' } } as Entity,
  ];
  const apps = [app('iam-oneke'), app('wazuh-oneke', 'Degraded'), app('misp-oneke', 'Healthy', 'OutOfSync'), app('datahub-oneke', 'Healthy', 'Synced', 'nato-sirtap-datahub-oneke'), app('petstore', 'Progressing'), app('segments-oneke')];
  const bands = clusterBands(entities, apps);
  const band = (l: string) => bands.find(b => b.layer === l)!;

  it('keeps the order of the catalogue, business first and development services last', () => {
    expect(bands.map(b => b.layer)).toEqual(ARCH_BANDS);
    expect(ARCH_BANDS).toEqual(['biz', 'app', 'dat', 'ops', 'dev', 'obs', 'sec', 'inf', 'fwk']);
  });

  it('puts each piece in its band with its namespace, product and Argo CD state', () => {
    expect(band('biz').tiles).toMatchObject([{ name: 'petstore', namespace: 'nato-sirtap-petstore', health: 'warn', sub: 'application-instance · pro' }]);
    // problems first; a suspended piece is a warning whatever Argo CD says
    expect(band('sec').tiles.map(x => [x.name, x.health, x.namespace])).toEqual([
      ['wazuh', 'bad', 'nato-sirtap-wazuh-oneke'],
      ['misp', 'warn', 'nato-sirtap-misp-oneke'],
      ['iam', 'ok', 'nato-sirtap-iam-oneke'],
    ]);
    expect(band('sec').tiles[2].sub).toBe('Keycloak 26.5');
    expect(band('sec').tiles[1].healthLabel).toBe('suspended');
    expect(band('sec')).toMatchObject({ namespaces: 3, without: 0 });
    // no annotation: the namespace of its Argo CD application
    expect(band('dat').tiles).toMatchObject([{ name: 'datahub', namespace: 'nato-sirtap-datahub-oneke', health: 'ok' }]);
  });

  it('says so when a piece has no namespace', () => {
    expect(band('inf').tiles).toMatchObject([{ name: 'segments', namespace: undefined, health: 'ok' }]);
    expect(band('inf')).toMatchObject({ namespaces: 0, without: 1 });
    expect(band('fwk').tiles).toMatchObject([{ name: 'Python Framework', namespace: undefined, health: 'off' }]);
    // what the catalogue does not list (a library, an API) is not drawn
    expect(bands.flatMap(b => b.tiles.map(x => x.name))).not.toContain('something');
    expect(bands.flatMap(b => b.tiles)).toHaveLength(7);
  });

  it('finds the Argo CD application with or without -oneke', () => {
    expect(appOf('iam', apps)?.name).toBe('iam-oneke');
    expect(appOf('iam-oneke', [app('iam')])?.name).toBe('iam');
    expect(appOf('nope', apps)).toBeUndefined();
    expect(monogram('Python Framework')).toBe('PF');
    expect(monogram('iam')).toBe('IA');
    expect(monogram('argo-workflows-demo')).toBe('AW');
  });
});
