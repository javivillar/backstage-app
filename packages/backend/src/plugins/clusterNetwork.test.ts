import { isolationOf, type K8sNamespace, selectorText, summariseNetwork, summarisePolicy } from './clusterNetwork';

const ns = (name: string, segment?: string): K8sNamespace => ({ metadata: { name, labels: segment ? { 'refresquito.io/segment': segment } : {} } });

describe('clusterNetwork', () => {
  it('describes selectors and peers in words', () => {
    expect(selectorText(undefined)).toBe('all');
    expect(selectorText({})).toBe('all');
    expect(selectorText({ matchLabels: { app: 'api' } })).toBe('app=api');
    const p = summarisePolicy({
      metadata: { name: 'allow-ingress', namespace: 'petstore' },
      spec: {
        podSelector: {},
        policyTypes: ['Ingress', 'Egress'],
        ingress: [{ from: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'traefik-system' } } }], ports: [{ port: 8080 }] }],
        egress: [{ to: [{ ipBlock: { cidr: '10.0.0.0/8' } }] }, {}],
      },
    });
    expect(p).toEqual({
      name: 'allow-ingress',
      appliesTo: 'all',
      ingress: true,
      egress: true,
      from: ['namespace traefik-system (TCP 8080)'],
      to: ['addresses 10.0.0.0/8', 'anywhere'],
    });
  });

  it('classifies isolation by the ingress policies', () => {
    const pol = (appliesTo: string, ingress = true) => ({ name: 'x', appliesTo, from: [], to: [], ingress, egress: !ingress });
    expect(isolationOf([])).toBe('open');
    expect(isolationOf([pol('app=db')])).toBe('partial');
    expect(isolationOf([pol('app=db'), pol('all')])).toBe('isolated');
    expect(isolationOf([pol('all', false)])).toBe('open');
  });

  it('joins hosts, segments and namespaces', () => {
    const n = summariseNetwork({
      namespaces: [ns('petstore', 'business-support'), ns('iam', 'iam'), ns('kube-system')],
      ingresses: [{ metadata: { name: 'petstore', namespace: 'petstore' }, spec: { tls: [{ hosts: ['petstore.x'] }], rules: [{ host: 'petstore.x', http: { paths: [{ backend: { service: { name: 'petstore-ui' } } }] } }] } }],
      policies: [{ metadata: { name: 'only-traefik', namespace: 'petstore' }, spec: { podSelector: {}, ingress: [{ from: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'traefik-system' } } }] }] } }],
      calico: [
        { metadata: { name: 'refresquito.business-support' }, spec: { order: 800, namespaceSelector: 'refresquito.io/segment == "business-support"', ingress: [{ action: 'Pass' }], egress: [{ action: 'Pass' }] } },
        { metadata: { name: 'refresquito.iam' }, spec: { order: 100, namespaceSelector: 'refresquito.io/segment == "iam"', ingress: [{ action: 'Allow' }, { action: 'Deny' }] } },
      ],
      services: [{ metadata: { name: 'one-traefik', namespace: 'traefik-system', labels: { 'app.kubernetes.io/name': 'traefik' } }, spec: { ports: [{ port: 443, nodePort: 32443 }] } }],
      pods: { petstore: { ready: 2, total: 2 } },
      now: new Date('2026-11-01T00:00:00Z'),
    });
    expect(n.entry).toEqual({ service: 'one-traefik', namespace: 'traefik-system', ports: ['443→32443'] });
    expect(n.hosts).toEqual([{ host: 'petstore.x', namespace: 'petstore', ingress: 'petstore', service: 'petstore-ui', tls: true }]);
    const pet = n.namespaces.find(x => x.name === 'petstore');
    expect(pet).toMatchObject({ segment: 'business-support', system: false, hosts: ['petstore.x'], isolation: 'isolated', egressRestricted: false, pods: { ready: 2, total: 2 } });
    expect(n.namespaces.find(x => x.name === 'kube-system')?.system).toBe(true);
    expect(n.segments).toEqual([
      { name: 'business-support', policy: 'refresquito.business-support', order: 800, enforced: false, actions: ['Pass'], namespaces: 1 },
      { name: 'iam', policy: 'refresquito.iam', order: 100, enforced: true, actions: ['Allow', 'Deny'], namespaces: 1 },
    ]);
    expect(n.warnings).toEqual([]);
  });
});
