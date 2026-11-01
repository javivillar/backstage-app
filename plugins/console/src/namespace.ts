import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useCallback, useEffect, useState } from 'react';

/** GET /api/cluster/namespaces/:ns/live (clusterNamespace.ts). */
export type PodLive = {
  name: string;
  ownerKind?: string;
  node?: string;
  phase?: string;
  ready: boolean;
  restarts24h: number;
  lastTermination?: string;
  cpu?: number;
  cpuRequest?: number;
  cpuLimit?: number;
  memory?: number;
  memoryRequest?: number;
  memoryLimit?: number;
};
export type NamespaceLive = { generatedAt: string; namespace: string; pods: PodLive[]; jobs?: PodLive[] };

/** GET /api/cluster/namespaces/:ns/workloads (clusterWorkloads.ts). */
export type WorkloadSummary = { kind: 'Deployment' | 'StatefulSet' | 'DaemonSet'; name: string; desired: number; ready: number; rollingOut: boolean; images: string[] };
export type EventSummary = { reason: string; object: string; message: string; count: number; last: string };
export type NamespaceWorkloads = { generatedAt: string; namespace: string; workloads: WorkloadSummary[]; events: EventSummary[]; warnings: string[] };

/** GET <cluster>/<path>, again every `everyMs`; undefined path: nothing is asked. */
export function useClusterGet<T>(path: string | undefined, everyMs = 30_000) {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; data?: T; error?: string }>({ loading: !!path });
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const res = await fetch(`${await discovery.getBaseUrl('cluster')}${path}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setState({ loading: false, data: body as T });
    } catch (e) {
      setState(s => ({ loading: false, data: s.data, error: (e as Error).message }));
    }
  }, [discovery, fetch, path]);
  useEffect(() => {
    load();
    if (!everyMs) return undefined;
    const t = setInterval(load, everyMs);
    return () => clearInterval(t);
  }, [load, everyMs]);
  return { ...state, reload: load };
}

export const useNamespaceLive = (ns?: string) => useClusterGet<NamespaceLive>(ns ? `/namespaces/${encodeURIComponent(ns)}/live` : undefined);
export const useNamespaceWorkloads = (ns?: string) => useClusterGet<NamespaceWorkloads>(ns ? `/namespaces/${encodeURIComponent(ns)}/workloads` : undefined);
