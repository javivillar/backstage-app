import { QUERIES, type Query, readOverview } from './clusterOverview';

const s = (metric: Record<string, string>, v: number | string) => ({ metric, value: [0, String(v)] as [number, string] });

const data: Record<string, ReturnType<typeof s>[]> = {
  [QUERIES.info]: [
    s({ node: 'n1', internal_ip: '10.0.0.1', kubelet_version: 'v1.33.4+rke2r1', os_image: 'Ubuntu 22.04.5 LTS' }, 1),
    s({ node: 'n2', internal_ip: '10.0.0.2', kubelet_version: 'v1.33.4+rke2r1', os_image: 'Ubuntu 22.04.5 LTS' }, 1),
  ],
  [QUERIES.roles]: [s({ node: 'n1', role: 'master' }, 1), s({ node: 'n1', role: 'etcd' }, 1), s({ node: 'n1', role: 'master' }, 1)],
  [QUERIES.ready]: [s({ node: 'n1' }, 1), s({ node: 'n2' }, 0)],
  [QUERIES.unschedulable]: [s({ node: 'n1' }, 0), s({ node: 'n2' }, 1)],
  [QUERIES.allocatable]: [s({ node: 'n1', resource: 'cpu' }, 10), s({ node: 'n1', resource: 'memory' }, 20e9)],
  [QUERIES.requested]: [s({ node: 'n1', resource: 'cpu' }, 4.5), s({ node: 'n1', resource: 'memory' }, 8e9)],
  [QUERIES.pods]: [s({ node: 'n1' }, 31)],
  [QUERIES.cpuUsed]: [s({ instance: '10.0.0.1:9100' }, 0.25)],
  [QUERIES.memUsed]: [s({ instance: '10.0.0.1:9100' }, 0.5)],
  [QUERIES.apps]: [
    s({ name: 'iam-oneke', dest_namespace: 'z-p-iam-oneke', project: 'default', sync_status: 'Synced', health_status: 'Healthy', autosync_enabled: 'true' }, 1),
    s({ name: 'bpm-oneke', dest_namespace: 'z-p-bpm-oneke', sync_status: 'OutOfSync', health_status: 'Degraded' }, 1),
  ],
  [QUERIES.pvcRequested]: [s({ namespace: 'a', persistentvolumeclaim: 'p1' }, 10e9), s({ namespace: 'a', persistentvolumeclaim: 'p2' }, 5e9), s({ namespace: 'b', persistentvolumeclaim: 'q' }, 20e9)],
  [QUERIES.pvcUsed]: [s({ namespace: 'a', persistentvolumeclaim: 'p1' }, 2e9)],
  [QUERIES.pvcInfo]: [s({ namespace: 'a', persistentvolumeclaim: 'p1', storageclass: 'longhorn' }, 1), s({ namespace: 'a', persistentvolumeclaim: 'p2', storageclass: 'longhorn-retain' }, 1), s({ namespace: 'b', persistentvolumeclaim: 'q', storageclass: 'longhorn' }, 1)],
  [QUERIES.pvcCapacity]: [s({ namespace: 'a', persistentvolumeclaim: 'p1' }, 10e9)],
  [QUERIES.restarting]: [s({ namespace: 'dh', pod: 'kafka-0' }, 11.1), s({ namespace: 'dh', pod: 'exporter' }, 12.4)],
};

const query: Query = async q => data[q] ?? [];

describe('readOverview', () => {
  it('joins nodes, requests and node-exporter usage', async () => {
    const o = await readOverview(query, new Date('2026-11-01T00:00:00Z'));
    expect(o.generatedAt).toBe('2026-11-01T00:00:00.000Z');
    expect(o.nodes.map(n => n.name)).toEqual(['n1', 'n2']);
    const [n1, n2] = o.nodes;
    expect(n1).toMatchObject({ ready: true, schedulable: true, pods: 31, roles: ['etcd', 'master'] });
    expect(n1.cpu).toEqual({ allocatable: 10, requested: 4.5, used: 0.25 });
    expect(n1.memory).toEqual({ allocatable: 20e9, requested: 8e9, used: 0.5 });
    expect(n2).toMatchObject({ ready: false, schedulable: false, pods: 0 });
    expect(n2.cpu.used).toBeUndefined();
  });

  it('lists Argo CD applications and volumes per namespace', async () => {
    const o = await readOverview(query);
    expect(o.apps).toEqual([
      { name: 'bpm-oneke', namespace: 'z-p-bpm-oneke', project: undefined, sync: 'OutOfSync', health: 'Degraded', autosync: false },
      { name: 'iam-oneke', namespace: 'z-p-iam-oneke', project: 'default', sync: 'Synced', health: 'Healthy', autosync: true },
    ]);
    expect(o.storage).toEqual([
      { namespace: 'b', volumes: 1, requestedBytes: 20e9, classes: { longhorn: 1 } },
      { namespace: 'a', volumes: 2, requestedBytes: 15e9, usedBytes: 2e9, classes: { longhorn: 1, 'longhorn-retain': 1 } },
    ]);
  });

  it('lists every volume, the fullest first', async () => {
    const o = await readOverview(query);
    expect(o.volumes).toEqual([
      { namespace: 'a', pvc: 'p1', requestedBytes: 10e9, usedBytes: 2e9, capacityBytes: 10e9, storageClass: 'longhorn' },
      { namespace: 'a', pvc: 'p2', requestedBytes: 5e9, storageClass: 'longhorn-retain' },
      { namespace: 'b', pvc: 'q', requestedBytes: 20e9, storageClass: 'longhorn' },
    ]);
  });

  it('lists the pods restarting in the last hour, most first', async () => {
    const o = await readOverview(query);
    expect(o.restarting).toEqual([
      { namespace: 'dh', pod: 'exporter', restarts1h: 12 },
      { namespace: 'dh', pod: 'kafka-0', restarts1h: 11 },
    ]);
  });
});
