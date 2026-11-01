import type { Query } from './clusterOverview';

/**
 * What runs in one namespace now, for the Live tab of an entity in the console: its pods with readiness, restarts in
 * the last 24 h, the reason of the last termination (OOMKilled, Error…), and CPU / memory in use against what they
 * request and their limit. Read from Prometheus (kube-state-metrics and cAdvisor).
 */
export type PodLive = {
  name: string;
  /** Deployment/ReplicaSet, StatefulSet, Job… that owns it */
  ownerKind?: string;
  node?: string;
  phase?: string;
  ready: boolean;
  restarts24h: number;
  lastTermination?: string;
  /** cores */
  cpu?: number;
  cpuRequest?: number;
  cpuLimit?: number;
  /** bytes */
  memory?: number;
  memoryRequest?: number;
  memoryLimit?: number;
};
/** pods: what runs now (not the pods of Jobs); jobs: the pods of Jobs that still exist (cron runs), newest first. */
export type NamespaceLive = { generatedAt: string; namespace: string; pods: PodLive[]; jobs: PodLive[] };

/** A Kubernetes namespace name, the only thing put into the queries. */
export const NAMESPACE_NAME = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

export function namespaceQueries(ns: string) {
  if (!NAMESPACE_NAME.test(ns)) throw new Error(`not a namespace name: ${ns}`);
  const ksm = `job="kube-state-metrics",namespace="${ns}"`;
  return {
    info: `kube_pod_info{${ksm}}`,
    owner: `kube_pod_owner{${ksm}}`,
    phase: `kube_pod_status_phase{${ksm}} == 1`,
    ready: `kube_pod_status_ready{${ksm},condition="true"}`,
    restarts: `sum by (pod) (increase(kube_pod_container_status_restarts_total{${ksm}}[24h]))`,
    reason: `kube_pod_container_status_last_terminated_reason{${ksm}} == 1`,
    cpu: `sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="${ns}",container!=""}[5m]))`,
    memory: `sum by (pod) (container_memory_working_set_bytes{namespace="${ns}",container!=""})`,
    requests: `sum by (pod, resource) (kube_pod_container_resource_requests{${ksm},resource=~"cpu|memory"})`,
    limits: `sum by (pod, resource) (kube_pod_container_resource_limits{${ksm},resource=~"cpu|memory"})`,
  };
}

export async function readNamespace(query: Query, ns: string, now = new Date()): Promise<NamespaceLive> {
  const qs = namespaceQueries(ns);
  const keys = Object.keys(qs) as Array<keyof typeof qs>;
  const results = await Promise.all(keys.map(k => query(qs[k])));
  const r = Object.fromEntries(keys.map((k, i) => [k, results[i]])) as Record<keyof typeof qs, Awaited<ReturnType<Query>>>;
  // only the pods that exist now (they have a phase): the 24 h series also hold pods long gone (cron runs)
  const pods = new Map<string, PodLive>();
  const num = (v: [number, string]) => Number(v[1]);
  for (const s of r.phase) if (s.metric.pod) pods.set(s.metric.pod, { name: s.metric.pod, phase: s.metric.phase, ready: false, restarts24h: 0 });
  const each = (series: Awaited<ReturnType<Query>>, f: (p: PodLive, s: { metric: Record<string, string>; value: [number, string] }) => void) => {
    for (const s of series) {
      const p = pods.get(s.metric.pod);
      if (p) f(p, s);
    }
  };
  each(r.info, (p, s) => (p.node = s.metric.node || undefined));
  each(r.owner, (p, s) => (p.ownerKind = s.metric.owner_kind || undefined));
  each(r.ready, (p, s) => (p.ready = num(s.value) === 1));
  each(r.restarts, (p, s) => (p.restarts24h = Math.round(num(s.value))));
  each(r.reason, (p, s) => (p.lastTermination = p.lastTermination ?? s.metric.reason));
  each(r.cpu, (p, s) => (p.cpu = num(s.value)));
  each(r.memory, (p, s) => (p.memory = num(s.value)));
  each(r.requests, (p, s) => {
    if (s.metric.resource === 'cpu') p.cpuRequest = num(s.value);
    if (s.metric.resource === 'memory') p.memoryRequest = num(s.value);
  });
  each(r.limits, (p, s) => {
    if (s.metric.resource === 'cpu') p.cpuLimit = num(s.value);
    if (s.metric.resource === 'memory') p.memoryLimit = num(s.value);
  });
  const all = [...pods.values()];
  const jobs = all.filter(p => p.ownerKind === 'Job').sort((a, b) => b.name.localeCompare(a.name));
  // pods of a finished run say nothing about the application now
  const list = all.filter(p => p.ownerKind !== 'Job' && p.phase !== 'Succeeded');
  const rank = (p: PodLive) => {
    if (!p.ready) return 0;
    return p.restarts24h > 0 ? 1 : 2;
  };
  return { generatedAt: now.toISOString(), namespace: ns, pods: list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)), jobs };
}
