import { summariseEvents, summariseWorkload, summariseWorkloads } from './clusterWorkloads';

const now = new Date('2026-11-01T10:00:00Z');

describe('clusterWorkloads', () => {
  it('counts replicas and notices a rollout', () => {
    expect(
      summariseWorkload('Deployment', {
        metadata: { name: 'api', generation: 4 },
        spec: { replicas: 2, template: { spec: { containers: [{ name: 'api', image: 'ghcr.io/x/api:1.2' }, { name: 'side', image: 'ghcr.io/x/api:1.2' }] } } },
        status: { readyReplicas: 1, updatedReplicas: 1, observedGeneration: 4 },
      }),
    ).toEqual({ kind: 'Deployment', name: 'api', desired: 2, ready: 1, rollingOut: true, images: ['ghcr.io/x/api:1.2'] });
    expect(summariseWorkload('DaemonSet', { metadata: { name: 'agent' }, status: { desiredNumberScheduled: 5, numberReady: 5 } })).toMatchObject({ desired: 5, ready: 5, rollingOut: false });
  });

  it('keeps the Warning events of the last hour, one line per object and reason', () => {
    const events = summariseEvents(
      [
        { type: 'Warning', reason: 'BackOff', message: 'Back-off restarting', count: 3, lastTimestamp: '2026-11-01T09:50:00Z', involvedObject: { kind: 'Pod', name: 'kafka-0' } },
        { type: 'Warning', reason: 'BackOff', message: 'Back-off restarting again', count: 2, lastTimestamp: '2026-11-01T09:55:00Z', involvedObject: { kind: 'Pod', name: 'kafka-0' } },
        { type: 'Warning', reason: 'FailedMount', count: 1, lastTimestamp: '2026-11-01T07:00:00Z', involvedObject: { kind: 'Pod', name: 'old' } },
        { type: 'Normal', reason: 'Pulled', lastTimestamp: '2026-11-01T09:59:00Z' },
        { type: 'Warning', reason: 'Unhealthy', count: 1, lastTimestamp: new Date('2026-11-01T09:40:00Z'), involvedObject: { kind: 'Pod', name: 'api' } },
      ],
      now,
    );
    expect(events).toEqual([
      { reason: 'BackOff', object: 'Pod kafka-0', message: 'Back-off restarting again', count: 5, last: '2026-11-01T09:55:00.000Z' },
      // the client gives Date objects: they count too
      { reason: 'Unhealthy', object: 'Pod api', message: '', count: 1, last: '2026-11-01T09:40:00.000Z' },
    ]);
  });

  it('puts the workloads not ready first', () => {
    const w = summariseWorkloads({
      namespace: 'shop',
      deployments: [{ metadata: { name: 'web' }, spec: { replicas: 1 }, status: { readyReplicas: 1 } }],
      statefulSets: [{ metadata: { name: 'db' }, spec: { replicas: 1 }, status: { readyReplicas: 0 } }],
      daemonSets: [],
      events: [],
      now,
    });
    expect(w.workloads.map(x => `${x.kind} ${x.name} ${x.ready}/${x.desired}`)).toEqual(['StatefulSet db 0/1', 'Deployment web 1/1']);
  });
});
