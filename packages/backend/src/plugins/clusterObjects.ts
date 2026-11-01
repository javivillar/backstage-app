/**
 * The Kubernetes objects of a namespace for the console (tabs Kubernetes and Topology of a service): workloads,
 * services, ingresses, pods, jobs, config maps, autoscalers and network policies, and how they connect
 * (ingress → service → workload → pods). Read only, with the service account of Backstage.
 */
type Raw = Record<string, any>;

export type K8sObjects = {
  namespace: string;
  workloads: Array<{ kind: string; name: string; desired: number; ready: number; selector: Record<string, string>; images: string[] }>;
  services: Array<{ name: string; type: string; clusterIP?: string; ports: string[]; selector: Record<string, string>; workloads: string[] }>;
  ingresses: Array<{ name: string; tls: boolean; routes: Array<{ host: string; path: string; service: string; port: string }> }>;
  pods: Array<{ name: string; phase: string; ready: boolean; restarts: number; node?: string; workload?: string; ip?: string }>;
  jobs: Array<{ kind: string; name: string; schedule?: string; last?: string; active: number }>;
  configMaps: string[];
  autoscalers: Array<{ name: string; target: string; min: number; max: number; current: number }>;
  networkPolicies: string[];
  errors: string[];
};

const matches = (selector: Record<string, string>, labels: Record<string, string> = {}) =>
  Object.keys(selector).length > 0 && Object.entries(selector).every(([k, v]) => labels[k] === v);

/** The objects as the console shows them, connected. lists: the raw items of each kind. */
export function summariseObjects(namespace: string, lists: Record<string, Raw[]>, errors: string[] = []): K8sObjects {
  const workloads = [
    ...(lists.deployments ?? []).map(d => ({ kind: 'Deployment', raw: d, ready: d.status?.readyReplicas ?? 0 })),
    ...(lists.statefulsets ?? []).map(d => ({ kind: 'StatefulSet', raw: d, ready: d.status?.readyReplicas ?? 0 })),
    ...(lists.daemonsets ?? []).map(d => ({ kind: 'DaemonSet', raw: d, ready: d.status?.numberReady ?? 0 })),
  ].map(({ kind, raw, ready }) => ({
    kind,
    name: String(raw.metadata?.name),
    desired: kind === 'DaemonSet' ? raw.status?.desiredNumberScheduled ?? 0 : raw.spec?.replicas ?? 1,
    ready,
    selector: (raw.spec?.selector?.matchLabels ?? {}) as Record<string, string>,
    labels: (raw.spec?.template?.metadata?.labels ?? {}) as Record<string, string>,
    images: ((raw.spec?.template?.spec?.containers ?? []) as Raw[]).map(c => String(c.image)),
  }));
  // a pod belongs to the workload whose selector matches its labels
  const podOwner = (labels: Record<string, string>) => workloads.find(w => matches(w.selector, labels))?.name;
  const services = (lists.services ?? []).map(s => {
    const selector = (s.spec?.selector ?? {}) as Record<string, string>;
    return {
      name: String(s.metadata?.name),
      type: String(s.spec?.type ?? 'ClusterIP'),
      clusterIP: s.spec?.clusterIP && s.spec.clusterIP !== 'None' ? String(s.spec.clusterIP) : undefined,
      ports: ((s.spec?.ports ?? []) as Raw[]).map(p => `${p.port}${p.targetPort && p.targetPort !== p.port ? `→${p.targetPort}` : ''}/${p.protocol ?? 'TCP'}`),
      selector,
      workloads: workloads.filter(w => matches(selector, w.labels)).map(w => w.name),
    };
  });
  const ingresses = (lists.ingresses ?? []).map(i => ({
    name: String(i.metadata?.name),
    tls: ((i.spec?.tls ?? []) as Raw[]).length > 0,
    routes: ((i.spec?.rules ?? []) as Raw[]).flatMap(r =>
      ((r.http?.paths ?? []) as Raw[]).map(p => ({
        host: String(r.host ?? '*'),
        path: String(p.path ?? '/'),
        service: String(p.backend?.service?.name ?? ''),
        port: String(p.backend?.service?.port?.number ?? p.backend?.service?.port?.name ?? ''),
      })),
    ),
  }));
  const pods = (lists.pods ?? []).map(p => {
    const statuses = (p.status?.containerStatuses ?? []) as Raw[];
    return {
      name: String(p.metadata?.name),
      phase: String(p.status?.phase ?? '?'),
      ready: statuses.length > 0 && statuses.every(c => c.ready),
      restarts: statuses.reduce((t, c) => t + (c.restartCount ?? 0), 0),
      node: p.spec?.nodeName,
      ip: p.status?.podIP,
      workload: podOwner(p.metadata?.labels ?? {}),
    };
  });
  const jobs = [
    ...(lists.cronjobs ?? []).map(c => ({ kind: 'CronJob', name: String(c.metadata?.name), schedule: c.spec?.schedule, last: c.status?.lastScheduleTime, active: (c.status?.active ?? []).length })),
    ...(lists.jobs ?? []).filter(j => !(j.metadata?.ownerReferences ?? []).length).map(j => ({ kind: 'Job', name: String(j.metadata?.name), last: j.status?.completionTime ?? j.status?.startTime, active: j.status?.active ?? 0 })),
  ];
  return {
    namespace,
    workloads: workloads.map(({ labels: _l, ...w }) => w),
    services,
    ingresses,
    pods,
    jobs,
    configMaps: (lists.configmaps ?? []).map(c => String(c.metadata?.name)).filter(n => n !== 'kube-root-ca.crt'),
    autoscalers: (lists.hpas ?? []).map(h => ({ name: String(h.metadata?.name), target: `${h.spec?.scaleTargetRef?.kind} ${h.spec?.scaleTargetRef?.name}`, min: h.spec?.minReplicas ?? 1, max: h.spec?.maxReplicas ?? 1, current: h.status?.currentReplicas ?? 0 })),
    networkPolicies: (lists.netpols ?? []).map(n => String(n.metadata?.name)),
    errors,
  };
}
