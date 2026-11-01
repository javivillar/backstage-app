import { needsAttention } from './attention';
import type { ClusterNetwork } from './network';
import type { ClusterOverview } from './overview';

const overview: ClusterOverview = {
  generatedAt: '',
  nodes: [
    { name: 'n1', roles: [], ready: false, schedulable: true, pods: 0, cpu: { allocatable: 4, requested: 1 }, memory: { allocatable: 100, requested: 10 } },
    { name: 'n2', roles: [], ready: true, schedulable: true, pods: 9, cpu: { allocatable: 4, requested: 1 }, memory: { allocatable: 100, requested: 95 } },
  ],
  apps: [
    { name: 'datahub-oneke', namespace: 'dh', sync: 'OutOfSync', health: 'Degraded', autosync: false },
    { name: 'iam-oneke', sync: 'Synced', health: 'Healthy', autosync: true },
  ],
  storage: [],
  volumes: [
    { namespace: 'a', pvc: 'full', requestedBytes: 10, capacityBytes: 10, usedBytes: 9.5 },
    { namespace: 'a', pvc: 'fine', requestedBytes: 10, capacityBytes: 10, usedBytes: 1 },
    { namespace: 'a', pvc: 'unmounted', requestedBytes: 10 },
  ],
};
const network: ClusterNetwork = {
  generatedAt: '',
  warnings: [],
  certificate: { name: 'cluster-wildcard', namespace: 't', dnsNames: [], notAfter: '2026-11-11T00:00:00Z', ready: true },
  hosts: [],
  segments: [],
  namespaces: [{ name: 'x', system: false, hosts: [], isolation: 'open', egressRestricted: false, policies: [] }],
};

describe('needsAttention', () => {
  it('lists the problems of the cluster, worst first', () => {
    const items = needsAttention(overview, network, new Date('2026-11-01T00:00:00Z'));
    expect(items.map(i => [i.severity, i.title])).toEqual([
      ['bad', 'Node n1 is not ready'],
      ['bad', 'datahub-oneke is Degraded'],
      ['bad', 'Volume full is 95% full'],
      ['warn', 'Node n2: 95% of its memory requested'],
      ['warn', 'The cluster certificate expires in 10 days'],
      ['info', '1 application out of sync with git'],
      ['info', '1 namespaces are open to the whole cluster'],
    ]);
  });

  it('works with only one of the two sources', () => {
    expect(needsAttention(undefined, undefined)).toEqual([]);
    expect(needsAttention(overview).length).toBe(5);
  });
});
