import type { Entity } from '@backstage/catalog-model';
import { createContext, type PropsWithChildren, useContext, useMemo } from 'react';
import { type ImageFindings, type NamespaceWeek, totals, useImageFindings, useNamespaceWeek } from '../entityData';
import { type NamespaceLive, type NamespaceWorkloads, useNamespaceLive, useNamespaceWorkloads } from '../namespace';
import { certificateDays, type ClusterNetwork, type NamespaceNetwork, useClusterNetwork } from '../network';
import { type AppOverview, useClusterOverview } from '../overview';
import { NAMESPACE_ANNOTATION } from './EntityNetwork';

/** Everything the console shows about one service, read once for the header and every tab. */
export type ServiceData = {
  entity: Entity;
  base: string;
  namespace?: string;
  app?: AppOverview;
  live?: NamespaceLive;
  workloads?: NamespaceWorkloads;
  network?: ClusterNetwork;
  ns?: NamespaceNetwork;
  findings: ImageFindings[];
  week?: NamespaceWeek;
  /** OpenCost can take minutes to answer a week: still reading, or why it failed */
  weekState?: { loading: boolean; error?: string };
  money: (v: number) => string;
  certDays?: number;
  images: string[];
};

const Ctx = createContext<ServiceData | undefined>(undefined);
export const useService = () => useContext(Ctx);

export const consoleEntityBase = (e: Entity) => `/console/entity/${e.metadata.namespace ?? 'default'}/${e.kind.toLowerCase()}/${e.metadata.name}`;

export const ServiceDataProvider = ({ entity, children }: PropsWithChildren<{ entity: Entity }>) => {
  const namespace = entity.metadata.annotations?.[NAMESPACE_ANNOTATION];
  const live = useNamespaceLive(namespace).data;
  const workloads = useNamespaceWorkloads(namespace).data;
  const network = useClusterNetwork().data;
  const overview = useClusterOverview().data;
  const images = useMemo(() => [...new Set((workloads?.workloads ?? []).flatMap(w => w.images))].sort(), [workloads]);
  const { findings } = useImageFindings(images);
  const { week, money, loading: weekLoading, error: weekError } = useNamespaceWeek(namespace);
  const value = useMemo<ServiceData>(
    () => ({
      entity,
      base: consoleEntityBase(entity),
      namespace,
      app: overview?.apps.find(a => a.name === entity.metadata.name || (!!namespace && a.namespace === namespace)),
      live,
      workloads,
      network,
      ns: network?.namespaces.find(n => n.name === namespace),
      findings,
      week,
      weekState: { loading: weekLoading, error: weekError },
      money,
      certDays: network ? certificateDays(network) : undefined,
      images,
    }),
    [entity, namespace, overview, live, workloads, network, findings, week, weekLoading, weekError, money, images],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'off';
export type Attention = { tone: Tone; title: string; detail: string; tab: string };

/** What needs attention on this service, worst first; each item says which tab explains it. */
export function serviceAttention(d: ServiceData): Attention[] {
  const out: Attention[] = [];
  if (d.app && d.app.health !== 'Healthy') out.push({ tone: d.app.health === 'Degraded' || d.app.health === 'Missing' ? 'bad' : 'warn', title: `Argo CD says ${d.app.health}`, detail: d.app.name, tab: 'live' });
  for (const p of d.live?.pods ?? []) {
    if (!p.ready) out.push({ tone: 'bad', title: `${p.name} is not ready`, detail: p.lastTermination ? `last end: ${p.lastTermination}` : p.phase ?? '', tab: 'live' });
    else if (p.lastTermination === 'OOMKilled') out.push({ tone: 'warn', title: `${p.name} ran out of memory`, detail: 'raise its memory limit or find the leak', tab: 'live' });
    else if (p.restarts24h > 3) out.push({ tone: 'warn', title: `${p.name} restarted ${p.restarts24h} times in 24 h`, detail: p.lastTermination ?? '', tab: 'live' });
  }
  for (const w of d.workloads?.workloads ?? []) if (w.ready < w.desired) out.push({ tone: 'bad', title: `${w.kind} ${w.name}: ${w.ready} of ${w.desired} ready`, detail: w.rollingOut ? 'rolling out' : '', tab: 'live' });
  if (d.workloads?.events.length) out.push({ tone: 'warn', title: `${d.workloads.events.length} warnings in the last hour`, detail: d.workloads.events[0].reason, tab: 'live' });
  const t = totals(d.findings);
  if (t.critical || t.kev) out.push({ tone: 'bad', title: `${t.critical} critical vulnerabilities${t.kev ? ` (${t.kev} known exploited)` : ''}`, detail: 'in the images it runs', tab: 'security' });
  else if (t.high) out.push({ tone: 'warn', title: `${t.high} high vulnerabilities`, detail: 'in the images it runs', tab: 'security' });
  if (d.app && d.app.sync !== 'Synced') out.push({ tone: 'info', title: 'Out of sync with git', detail: 'what runs is not what git says', tab: 'changes' });
  if (d.ns?.isolation === 'open') out.push({ tone: 'info', title: 'Open to the whole cluster', detail: 'no NetworkPolicy in its namespace', tab: 'network' });
  const order = { bad: 0, warn: 1, info: 2, ok: 3, off: 4 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}
