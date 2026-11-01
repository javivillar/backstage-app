import type { Query } from './clusterOverview';
import { namespaceQueries, readNamespace } from './clusterNamespace';

const s = (metric: Record<string, string>, v: number) => ({ metric, value: [0, String(v)] as [number, string] });

describe('clusterNamespace', () => {
  it('refuses anything that is not a namespace name', () => {
    expect(() => namespaceQueries('a"}or vector(1)')).toThrow();
    expect(namespaceQueries('nato-sirtap-petstore-oneke').ready).toContain('namespace="nato-sirtap-petstore-oneke"');
  });

  it('joins the pods with their use, requests and restarts, problems first', async () => {
    const q = namespaceQueries('shop');
    const data: Record<string, ReturnType<typeof s>[]> = {
      [q.info]: [s({ pod: 'api', node: 'n1' }, 1), s({ pod: 'db', node: 'n2' }, 1), s({ pod: 'job-x', node: 'n1' }, 1), s({ pod: 'run-2', node: 'n1' }, 1)],
      [q.owner]: [s({ pod: 'api', owner_kind: 'ReplicaSet' }, 1), s({ pod: 'job-x', owner_kind: 'Job' }, 1), s({ pod: 'run-2', owner_kind: 'Job' }, 1)],
      [q.phase]: [s({ pod: 'api', phase: 'Running' }, 1), s({ pod: 'db', phase: 'Running' }, 1), s({ pod: 'job-x', phase: 'Succeeded' }, 1), s({ pod: 'run-2', phase: 'Failed' }, 1)],
      [q.ready]: [s({ pod: 'db' }, 1), s({ pod: 'api' }, 0)],
      [q.restarts]: [s({ pod: 'api' }, 3.2), s({ pod: 'gone-cron-run' }, 1)],
      [q.reason]: [s({ pod: 'api', reason: 'OOMKilled' }, 1)],
      [q.cpu]: [s({ pod: 'api' }, 0.25), s({ pod: 'gone' }, 1)],
      [q.memory]: [s({ pod: 'api' }, 500e6)],
      [q.requests]: [s({ pod: 'api', resource: 'cpu' }, 0.5), s({ pod: 'api', resource: 'memory' }, 256e6)],
      [q.limits]: [s({ pod: 'api', resource: 'memory' }, 512e6)],
    };
    const query: Query = async x => data[x] ?? [];
    const live = await readNamespace(query, 'shop', new Date('2026-11-01T00:00:00Z'));
    expect(live.pods.map(p => p.name)).toEqual(['api', 'db']);
    expect(live.jobs.map(p => `${p.name} ${p.phase}`)).toEqual(['run-2 Failed', 'job-x Succeeded']);
    expect(live.pods[0]).toEqual({
      name: 'api', ownerKind: 'ReplicaSet', node: 'n1', phase: 'Running', ready: false, restarts24h: 3, lastTermination: 'OOMKilled',
      cpu: 0.25, cpuRequest: 0.5, memory: 500e6, memoryRequest: 256e6, memoryLimit: 512e6,
    });
    expect(live.pods[1]).toMatchObject({ name: 'db', ready: true, restarts24h: 0 });
  });
});
