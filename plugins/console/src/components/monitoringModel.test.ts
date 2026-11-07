import type { Entity } from '@backstage/catalog-model';
import { applicationsOf, canSee, exploreUrl, grafanaBase, grouped, servicesOf, slug, GRAFANA_SERVICES } from './monitoringModel';

const domain = (services: unknown, extra: Record<string, string> = {}): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Domain',
  metadata: {
    name: 'refresquito-nato-sirtap',
    annotations: {
      'refresquito.io/grafana-url': 'http://grafana.example',
      [GRAFANA_SERVICES]: typeof services === 'string' ? services : JSON.stringify(services),
      ...extra,
    },
  },
});

const component = (name: string, annotations: Record<string, string>, owner = 'platform-team', labels: Record<string, string> = {}): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name, annotations, labels },
  spec: { owner },
});

describe('servicesOf', () => {
  const iam = component('iam-oneke', { 'refresquito.io/product': 'Keycloak', 'refresquito.io/namespace': 'nato-sirtap-iam-oneke' });
  it('reads the services of the Domain with the title, namespace and folder of each', () => {
    const [s, p] = servicesOf(
      domain([
        { name: 'iam', component: 'iam-oneke', segment: 'iam', dashboards: [{ uid: 'kc', title: 'Keycloak Metrics', kind: 'performance' }, { uid: 'kc-logs', title: 'Keycloak Logs', kind: 'logs' }] },
        { name: 'platform', segment: 'platform', dashboards: [] },
      ]),
      [iam],
    );
    expect(s.title).toBe('Keycloak');
    expect(s.group).toBe('iam');
    expect(s.envs[0]).toMatchObject({ env: 'pro', folder: 'Services / iam / pro', namespace: 'nato-sirtap-iam-oneke', entityRef: 'component:default/iam-oneke' });
    expect(s.envs[0].dashboards.map(d => d.kind)).toEqual(['performance', 'logs']);
    expect(p).toMatchObject({ name: 'platform', title: 'platform', envs: [{ dashboards: [] }] });
    expect(p.envs[0].namespace).toBeUndefined();
  });
  it('takes the environment of the Domain and drops malformed entries and dashboards', () => {
    const list = servicesOf(domain([{ name: 'x', dashboards: [{ title: 'no uid' }, { uid: 'u' }] }, { segment: 'no name' }], { 'refresquito.io/grafana-environment': 'pre' }), []);
    expect(list).toHaveLength(1);
    expect(list[0].envs[0]).toMatchObject({ env: 'pre', folder: 'Services / x / pre', dashboards: [{ uid: 'u', title: 'u', kind: 'performance' }] });
  });
  it('gives nothing for a missing or unreadable annotation', () => {
    expect(servicesOf(undefined, [])).toEqual([]);
    expect(servicesOf(domain('{not json'), [])).toEqual([]);
    expect(servicesOf(domain({ not: 'a list' }), [])).toEqual([]);
  });
});

describe('applicationsOf', () => {
  const dep = (name: string, stage: string, extra: Record<string, string> = {}) =>
    component(
      name,
      {
        'refresquito.io/grafana-url': 'http://grafana.example',
        'refresquito.io/grafana-folder': `Applications / petstore / ${stage}`,
        'refresquito.io/grafana-logs': `${name}-logs`,
        'refresquito.io/grafana-performance': `${name}-performance`,
        'refresquito.io/application': 'petstore',
        'refresquito.io/stage': stage,
        'refresquito.io/namespace': `nato-sirtap-${name}`,
        ...extra,
      },
      'group:default/petstore-team',
      { 'refresquito.io/segment': 'business' },
    );
  it('groups the deployments of an application, pro first, with both dashboards', () => {
    const [a] = applicationsOf([dep('petstore-dev-oneke', 'dev'), dep('petstore-oneke', 'pro'), component('iam-oneke', {})]);
    expect(a).toMatchObject({ scope: 'applications', name: 'petstore', group: 'business', owner: 'group:default/petstore-team' });
    expect(a.envs.map(e => e.env)).toEqual(['pro', 'dev']);
    expect(a.envs[0].dashboards).toEqual([
      { uid: 'petstore-oneke-performance', title: 'Performance', kind: 'performance' },
      { uid: 'petstore-oneke-logs', title: 'Logs', kind: 'logs' },
    ]);
  });
  it('leaves out what is no application folder', () => {
    expect(applicationsOf([dep('x', 'pro', { 'refresquito.io/grafana-folder': 'Services / x / pro' })])).toEqual([]);
  });
});

describe('canSee', () => {
  const svc = servicesOf(domain([{ name: 'dfir-iris', dashboards: [] }]), [])[0];
  const app = { ...svc, scope: 'applications' as const, name: 'petstore', owner: 'petstore-team' };
  it('lets admins see everything', () => expect(canSee(svc, new Set(), true)).toBe(true));
  it('needs the Grafana group of the service', () => {
    expect(canSee(svc, new Set(['group:default/grafana-dfir-iris-viewers']), false)).toBe(true);
    expect(canSee(svc, new Set(['group:default/grafana-dfir-iris-editors']), false)).toBe(true);
    expect(canSee(svc, new Set(['group:default/grafana-iam-viewers']), false)).toBe(false);
  });
  it('lets the owner team see its application', () => {
    expect(canSee(app, new Set(['group:default/petstore-team']), false)).toBe(true);
    expect(canSee(app, new Set(['group:default/other']), false)).toBe(false);
  });
  it('slugs names as the access job does', () => expect(slug('My_App.x')).toBe('my-app-x'));
});

describe('exploreUrl', () => {
  it('opens Loki on the namespace for logs', () => {
    const u = exploreUrl('http://g/', 'logs', 'nato-sirtap-iam-oneke', '6h');
    expect(u.startsWith('http://g/explore?left=')).toBe(true);
    expect(JSON.parse(decodeURIComponent(u.split('left=')[1]))).toEqual(['now-6h', 'now', 'Loki', { expr: '{namespace="nato-sirtap-iam-oneke"}' }]);
  });
  it('opens Prometheus on the namespace for performance', () => {
    const left = JSON.parse(decodeURIComponent(exploreUrl('http://g', 'performance', 'ns', '1h').split('left=')[1]));
    expect(left[2]).toBe('Prometheus');
    expect(left[3].expr).toContain('namespace="ns"');
  });
});

describe('grafanaBase and grouped', () => {
  it('prefers the Domain URL', () => {
    expect(grafanaBase(domain([]), [])).toBe('http://grafana.example');
    expect(grafanaBase(undefined, [component('a', { 'refresquito.io/grafana-url': 'http://other' })])).toBe('http://other');
  });
  it('sorts groups and their items', () => {
    const list = servicesOf(domain([{ name: 'b', segment: 'soc' }, { name: 'a', segment: 'soc' }, { name: 'c', segment: 'iam' }]), []);
    expect(grouped(list).map(g => [g.group, g.items.map(i => i.name)])).toEqual([['iam', ['c']], ['soc', ['a', 'b']]]);
  });
});
