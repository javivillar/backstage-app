import { summariseObjects } from './clusterObjects';

describe('objects of a namespace', () => {
  it('connects ingress → service → workload → pods', () => {
    const o = summariseObjects('shop', {
      deployments: [{ metadata: { name: 'api' }, spec: { replicas: 2, selector: { matchLabels: { app: 'api' } }, template: { metadata: { labels: { app: 'api', tier: 'b' } }, spec: { containers: [{ image: 'ghcr.io/x/api:1' }] } } }, status: { readyReplicas: 1 } }],
      services: [{ metadata: { name: 'api' }, spec: { type: 'ClusterIP', clusterIP: '10.0.0.1', selector: { app: 'api' }, ports: [{ port: 80, targetPort: 8000 }] } }],
      ingresses: [{ metadata: { name: 'web' }, spec: { tls: [{}], rules: [{ host: 'shop.x', http: { paths: [{ path: '/api', backend: { service: { name: 'api', port: { number: 80 } } } }] } }] } }],
      pods: [{ metadata: { name: 'api-1', labels: { app: 'api' } }, spec: { nodeName: 'n1' }, status: { phase: 'Running', podIP: '1.2.3.4', containerStatuses: [{ ready: true, restartCount: 2 }] } }],
      configmaps: [{ metadata: { name: 'kube-root-ca.crt' } }, { metadata: { name: 'settings' } }],
      jobs: [{ metadata: { name: 'from-cron', ownerReferences: [{}] } }, { metadata: { name: 'migrate' }, status: { active: 0 } }],
    });
    expect(o.workloads).toEqual([{ kind: 'Deployment', name: 'api', desired: 2, ready: 1, selector: { app: 'api' }, images: ['ghcr.io/x/api:1'] }]);
    expect(o.services[0]).toMatchObject({ name: 'api', ports: ['80→8000/TCP'], workloads: ['api'] });
    expect(o.ingresses[0]).toEqual({ name: 'web', tls: true, routes: [{ host: 'shop.x', path: '/api', service: 'api', port: '80' }] });
    expect(o.pods[0]).toMatchObject({ name: 'api-1', ready: true, restarts: 2, workload: 'api', node: 'n1' });
    expect(o.configMaps).toEqual(['settings']);
    expect(o.jobs.map(j => j.name)).toEqual(['migrate']);
  });
});
