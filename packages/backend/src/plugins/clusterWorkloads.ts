/**
 * The workloads of one namespace (Deployments, StatefulSets, DaemonSets: replicas ready and the images they run) and
 * its Warning events of the last hour, for the namespace page and the Live tab of the console. Read-only.
 */

type Container = { name: string; image?: string };
type PodTemplate = { spec?: { containers?: Container[] } };
export type K8sWorkload = {
  kind?: string;
  metadata: { name: string; namespace?: string; generation?: number };
  spec?: { replicas?: number; template?: PodTemplate };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    updatedReplicas?: number;
    availableReplicas?: number;
    observedGeneration?: number;
    desiredNumberScheduled?: number;
    numberReady?: number;
  };
};
export type K8sEvent = {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  lastTimestamp?: string;
  eventTime?: string;
  metadata?: { creationTimestamp?: string };
  involvedObject?: { kind?: string; name?: string };
  series?: { count?: number; lastObservedTime?: string };
};

export type WorkloadSummary = {
  kind: 'Deployment' | 'StatefulSet' | 'DaemonSet';
  name: string;
  desired: number;
  ready: number;
  /** a new version is still rolling out */
  rollingOut: boolean;
  images: string[];
};
export type EventSummary = { reason: string; object: string; message: string; count: number; last: string };
export type NamespaceWorkloads = { generatedAt: string; namespace: string; workloads: WorkloadSummary[]; events: EventSummary[]; warnings: string[] };

export function summariseWorkload(kind: WorkloadSummary['kind'], w: K8sWorkload): WorkloadSummary {
  const st = w.status ?? {};
  const daemon = kind === 'DaemonSet';
  const desired = daemon ? st.desiredNumberScheduled ?? 0 : w.spec?.replicas ?? 1;
  const ready = daemon ? st.numberReady ?? 0 : st.readyReplicas ?? 0;
  const rollingOut =
    (st.observedGeneration !== undefined && w.metadata.generation !== undefined && st.observedGeneration < w.metadata.generation) ||
    (!daemon && (st.updatedReplicas ?? desired) < desired);
  return {
    kind,
    name: w.metadata.name,
    desired,
    ready,
    rollingOut,
    images: [...new Set((w.spec?.template?.spec?.containers ?? []).map(c => c.image ?? '').filter(Boolean))],
  };
}

/** Warning events seen in the last `withinMs`, the newest first, one line per object and reason. */
export function summariseEvents(events: K8sEvent[], now = new Date(), withinMs = 3_600_000): EventSummary[] {
  const out = new Map<string, EventSummary>();
  for (const e of events) {
    if (e.type !== 'Warning') continue;
    const last = e.series?.lastObservedTime ?? e.lastTimestamp ?? e.eventTime ?? e.metadata?.creationTimestamp;
    if (!last || now.getTime() - Date.parse(last) > withinMs) continue;
    const object = `${e.involvedObject?.kind ?? ''} ${e.involvedObject?.name ?? ''}`.trim();
    const key = `${object}|${e.reason}`;
    const count = e.series?.count ?? e.count ?? 1;
    const prev = out.get(key);
    if (!prev || prev.last < last) out.set(key, { reason: e.reason ?? 'Warning', object, message: (e.message ?? '').slice(0, 300), count: (prev?.count ?? 0) + count, last });
    else prev.count += count;
  }
  return [...out.values()].sort((a, b) => b.last.localeCompare(a.last));
}

export function summariseWorkloads(input: {
  namespace: string;
  deployments: K8sWorkload[];
  statefulSets: K8sWorkload[];
  daemonSets: K8sWorkload[];
  events: K8sEvent[];
  warnings?: string[];
  now?: Date;
}): NamespaceWorkloads {
  const now = input.now ?? new Date();
  const workloads = [
    ...input.deployments.map(w => summariseWorkload('Deployment', w)),
    ...input.statefulSets.map(w => summariseWorkload('StatefulSet', w)),
    ...input.daemonSets.map(w => summariseWorkload('DaemonSet', w)),
  ];
  const rank = (w: WorkloadSummary) => (w.ready < w.desired ? 0 : 1);
  workloads.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return { generatedAt: now.toISOString(), namespace: input.namespace, workloads, events: summariseEvents(input.events, now), warnings: input.warnings ?? [] };
}
