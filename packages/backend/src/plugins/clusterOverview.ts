/**
 * The overview of this cluster for the console (/console/cluster), read from the Prometheus that scrapes
 * kube-state-metrics, node-exporter, kubelet and Argo CD (observability-oneke). Read-only: no Kubernetes permissions.
 * The kube_* series are taken only from job kube-state-metrics: OpenCost exports some of them too, which counted
 * every request twice.
 */

type Sample = { metric: Record<string, string>; value: [number, string] };
export type Query = (promql: string) => Promise<Sample[]>;

export const QUERIES = {
  info: 'kube_node_info{job="kube-state-metrics"}',
  roles: 'kube_node_role{job="kube-state-metrics"}',
  ready: 'kube_node_status_condition{job="kube-state-metrics",condition="Ready",status="true"}',
  unschedulable: 'kube_node_spec_unschedulable{job="kube-state-metrics"}',
  allocatable: 'kube_node_status_allocatable{job="kube-state-metrics",resource=~"cpu|memory"}',
  requested:
    'sum by (node, resource) (kube_pod_container_resource_requests{job="kube-state-metrics",resource=~"cpu|memory"} * on (namespace, pod) group_left () (kube_pod_status_phase{job="kube-state-metrics",phase="Running"} == 1))',
  pods: 'count by (node) (kube_pod_info{job="kube-state-metrics"} * on (namespace, pod) group_left () (kube_pod_status_phase{job="kube-state-metrics",phase="Running"} == 1))',
  cpuUsed: '1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m]))',
  memUsed: '1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes',
  apps: 'argocd_app_info',
  pvcRequested: 'kube_persistentvolumeclaim_resource_requests_storage_bytes{job="kube-state-metrics"}',
  pvcUsed: 'kubelet_volume_stats_used_bytes',
  pvcInfo: 'kube_persistentvolumeclaim_info{job="kube-state-metrics"}',
  pvcCapacity: 'kubelet_volume_stats_capacity_bytes',
  restarting: 'sum by (namespace, pod) (increase(kube_pod_container_status_restarts_total{job="kube-state-metrics"}[1h])) > 2',
} as const;

export type Resource = { allocatable: number; requested: number; used?: number };
export type NodeOverview = {
  name: string;
  ip?: string;
  roles: string[];
  kubelet?: string;
  os?: string;
  ready: boolean;
  schedulable: boolean;
  pods: number;
  cpu: Resource;
  /** bytes; used is a fraction 0..1 like cpu.used */
  memory: Resource;
};
export type AppOverview = { name: string; namespace?: string; project?: string; sync: string; health: string; autosync: boolean };
/** One volume: its size as requested, and the real capacity and use when the kubelet reports it (mounted). */
export type VolumeOverview = { namespace: string; pvc: string; requestedBytes: number; capacityBytes?: number; usedBytes?: number; storageClass?: string };
export type StorageNamespace = { namespace: string; volumes: number; requestedBytes: number; usedBytes?: number; classes: Record<string, number> };
export type ClusterOverview = {
  generatedAt: string;
  nodes: NodeOverview[];
  apps: AppOverview[];
  storage: StorageNamespace[];
  volumes: VolumeOverview[];
  /** pods restarted more than twice in the last hour (crash loops), most first */
  restarting: Array<{ namespace: string; pod: string; restarts1h: number }>;
};

const num = (s: Sample) => Number(s.value[1]);
const host = (instance: string) => instance.replace(/:\d+$/, '');

export async function readOverview(query: Query, now = new Date()): Promise<ClusterOverview> {
  const keys = Object.keys(QUERIES) as Array<keyof typeof QUERIES>;
  const results = await Promise.all(keys.map(k => query(QUERIES[k])));
  const r = Object.fromEntries(keys.map((k, i) => [k, results[i]])) as Record<keyof typeof QUERIES, Sample[]>;

  const nodes = new Map<string, NodeOverview>();
  const node = (name: string) => {
    let n = nodes.get(name);
    if (!n) {
      n = { name, roles: [], ready: false, schedulable: true, pods: 0, cpu: { allocatable: 0, requested: 0 }, memory: { allocatable: 0, requested: 0 } };
      nodes.set(name, n);
    }
    return n;
  };
  for (const s of r.info) {
    const n = node(s.metric.node);
    n.ip = s.metric.internal_ip;
    n.kubelet = s.metric.kubelet_version;
    n.os = s.metric.os_image;
  }
  for (const s of r.roles) if (s.metric.node && s.metric.role) node(s.metric.node).roles.push(s.metric.role);
  for (const s of r.ready) if (num(s) === 1) node(s.metric.node).ready = true;
  for (const s of r.unschedulable) if (num(s) === 1) node(s.metric.node).schedulable = false;
  for (const s of r.pods) node(s.metric.node).pods = num(s);
  for (const s of r.allocatable) {
    const n = node(s.metric.node);
    if (s.metric.resource === 'cpu') n.cpu.allocatable = num(s);
    if (s.metric.resource === 'memory') n.memory.allocatable = num(s);
  }
  for (const s of r.requested) {
    if (!s.metric.node) continue;
    const n = node(s.metric.node);
    if (s.metric.resource === 'cpu') n.cpu.requested = num(s);
    if (s.metric.resource === 'memory') n.memory.requested = num(s);
  }
  const byIp = new Map([...nodes.values()].filter(n => n.ip).map(n => [n.ip as string, n]));
  for (const s of r.cpuUsed) {
    const n = byIp.get(host(s.metric.instance ?? ''));
    if (n) n.cpu.used = num(s);
  }
  for (const s of r.memUsed) {
    const n = byIp.get(host(s.metric.instance ?? ''));
    if (n) n.memory.used = num(s);
  }
  for (const n of nodes.values()) n.roles = [...new Set(n.roles)].sort();

  const apps = new Map<string, AppOverview>();
  for (const s of r.apps) {
    const m = s.metric;
    if (!m.name) continue;
    apps.set(m.name, {
      name: m.name,
      namespace: m.dest_namespace,
      project: m.project,
      sync: m.sync_status ?? 'Unknown',
      health: m.health_status ?? 'Unknown',
      autosync: m.autosync_enabled === 'true',
    });
  }

  const storage = new Map<string, StorageNamespace>();
  const ns = (name: string) => {
    let x = storage.get(name);
    if (!x) {
      x = { namespace: name, volumes: 0, requestedBytes: 0, classes: {} };
      storage.set(name, x);
    }
    return x;
  };
  for (const s of r.pvcRequested) {
    const x = ns(s.metric.namespace);
    x.volumes += 1;
    x.requestedBytes += num(s);
  }
  for (const s of r.pvcUsed) {
    const x = ns(s.metric.namespace);
    x.usedBytes = (x.usedBytes ?? 0) + num(s);
  }
  for (const s of r.pvcInfo) {
    const cls = s.metric.storageclass || 'none';
    const x = ns(s.metric.namespace);
    x.classes[cls] = (x.classes[cls] ?? 0) + 1;
  }

  const volumes = new Map<string, VolumeOverview>();
  const vol = (m: Record<string, string>) => {
    const key = `${m.namespace}/${m.persistentvolumeclaim}`;
    let v = volumes.get(key);
    if (!v) {
      v = { namespace: m.namespace, pvc: m.persistentvolumeclaim, requestedBytes: 0 };
      volumes.set(key, v);
    }
    return v;
  };
  for (const x of r.pvcRequested) if (x.metric.persistentvolumeclaim) vol(x.metric).requestedBytes = num(x);
  for (const x of r.pvcUsed) if (x.metric.persistentvolumeclaim) vol(x.metric).usedBytes = num(x);
  for (const x of r.pvcCapacity) if (x.metric.persistentvolumeclaim) vol(x.metric).capacityBytes = num(x);
  for (const x of r.pvcInfo) if (x.metric.persistentvolumeclaim) vol(x.metric).storageClass = x.metric.storageclass || undefined;
  const usedShare = (v: VolumeOverview) => (v.usedBytes !== undefined && v.capacityBytes ? v.usedBytes / v.capacityBytes : -1);

  return {
    generatedAt: now.toISOString(),
    restarting: r.restarting
      .filter(x => x.metric.pod)
      .map(x => ({ namespace: x.metric.namespace, pod: x.metric.pod, restarts1h: Math.round(num(x)) }))
      .sort((a, b) => b.restarts1h - a.restarts1h),
    volumes: [...volumes.values()].sort((a, b) => usedShare(b) - usedShare(a) || a.pvc.localeCompare(b.pvc)),
    nodes: [...nodes.values()].sort((a, b) => a.name.localeCompare(b.name)),
    apps: [...apps.values()].sort((a, b) => a.name.localeCompare(b.name)),
    storage: [...storage.values()].sort((a, b) => b.requestedBytes - a.requestedBytes),
  };
}

/** A Query over the HTTP API of Prometheus. */
export const prometheusQuery =
  (baseUrl: string, timeoutMs = 20_000): Query =>
  async promql => {
    const res = await fetch(`${baseUrl}/api/v1/query?query=${encodeURIComponent(promql)}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`Prometheus answered ${res.status} ${res.statusText}`);
    const body = (await res.json()) as { status: string; data?: { result?: Sample[] }; error?: string };
    if (body.status !== 'success') throw new Error(`Prometheus: ${body.error ?? body.status}`);
    return body.data?.result ?? [];
  };
