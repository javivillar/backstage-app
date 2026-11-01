import type { Query } from './clusterOverview';

/**
 * What runs in one namespace now, for the Live tab of an entity in the console: its pods with readiness, restarts in
 * the last 24 h, the reason of the last termination (OOMKilled, Error…), and CPU / memory in use against what they
 * request and their limit. Read from Prometheus (kube-state-metrics and cAdvisor).
 */
export type PodLive = {
  name: string;
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
export type NamespaceLive = { generatedAt: string; namespace: string; pods: PodLive[] };

/** A Kubernetes namespace name, the only thing put into the queries. */
export const NAMESPACE_NAME = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

export function namespaceQueries(ns: string) {
  if (!NAMESPACE_NAME.test(ns)) throw new Error(`not a namespace name: ${ns}`);
  const ksm = `job="kube-state-metrics",namespace="${ns}"`;
  return {
    info: `kube_pod_info{${ksm}}`,
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
  const pods = new Map<string, PodLive>();
  const pod = (name: string) => {
    let p = pods.get(name);
    if (!p) {
      p = { name, ready: false, restarts24h: 0 };
      pods.set(name, p);
    }
    return p;
  };
  const num = (v: [number, string]) => Number(v[1]);
  for (const s of r.info) if (s.metric.pod) pod(s.metric.pod).node = s.metric.node || undefined;
  for (const s of r.phase) if (s.metric.pod) pod(s.metric.pod).phase = s.metric.phase;
  for (const s of r.ready) if (s.metric.pod && num(s.value) === 1) pod(s.metric.pod).ready = true;
  for (const s of r.restarts) if (s.metric.pod) pod(s.metric.pod).restarts24h = Math.round(num(s.value));
  for (const s of r.reason) if (s.metric.pod && !pod(s.metric.pod).lastTermination) pod(s.metric.pod).lastTermination = s.metric.reason;
  for (const s of r.cpu) if (pods.has(s.metric.pod)) pod(s.metric.pod).cpu = num(s.value);
  for (const s of r.memory) if (pods.has(s.metric.pod)) pod(s.metric.pod).memory = num(s.value);
  for (const s of r.requests) {
    if (!s.metric.pod) continue;
    if (s.metric.resource === 'cpu') pod(s.metric.pod).cpuRequest = num(s.value);
    if (s.metric.resource === 'memory') pod(s.metric.pod).memoryRequest = num(s.value);
  }
  for (const s of r.limits) {
    if (!s.metric.pod) continue;
    if (s.metric.resource === 'cpu') pod(s.metric.pod).cpuLimit = num(s.value);
    if (s.metric.resource === 'memory') pod(s.metric.pod).memoryLimit = num(s.value);
  }
  // pods of finished jobs (Succeeded) say nothing about the application now
  const list = [...pods.values()].filter(p => p.phase !== 'Succeeded');
  const rank = (p: PodLive) => {
    if (!p.ready) return 0;
    return p.restarts24h > 0 ? 1 : 2;
  };
  return { generatedAt: now.toISOString(), namespace: ns, pods: list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)) };
}
