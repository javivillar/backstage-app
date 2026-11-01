import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useCallback, useEffect, useState } from 'react';

/** The answer of GET /api/cluster/overview (backend plugin cluster). */
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
  memory: Resource;
};
export type AppOverview = { name: string; namespace?: string; project?: string; sync: string; health: string; autosync: boolean };
export type StorageNamespace = { namespace: string; volumes: number; requestedBytes: number; usedBytes?: number; classes: Record<string, number> };
export type VolumeOverview = { namespace: string; pvc: string; requestedBytes: number; capacityBytes?: number; usedBytes?: number; storageClass?: string };
export type ClusterOverview = {
  generatedAt: string;
  nodes: NodeOverview[];
  apps: AppOverview[];
  storage: StorageNamespace[];
  volumes?: VolumeOverview[];
  restarting?: Array<{ namespace: string; pod: string; restarts1h: number }>;
};

export function useClusterOverview() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; data?: ClusterOverview; error?: string }>({ loading: true });
  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const res = await fetch(`${await discovery.getBaseUrl('cluster')}/overview`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setState({ loading: false, data: body as ClusterOverview });
    } catch (e) {
      setState({ loading: false, error: (e as Error).message });
    }
  }, [discovery, fetch]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load };
}
