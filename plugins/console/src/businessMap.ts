import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useEffect, useState } from 'react';

/**
 * STUB of worker F (dashboards) so its branch compiles: worker E owns this file and the lead keeps E's version.
 * Only the names and shapes of the release-2 contract.
 */
export type MapResult = 'meets' | 'gap' | 'unknown';
export type MapCriticality = 'critical' | 'important' | 'standard';

export type MapDomain = { ref: string; title: string; pcfId?: string; parent?: string };
export type MapProcess = {
  ref: string;
  title: string;
  domain: string;
  owner: string;
  criticality: MapCriticality;
  requirement: { rpo: string | null; rto: string | null; retention?: string | null; from: { rpo: 'default' | 'override'; rto: 'default' | 'override' } };
  pcfId?: string;
  modelId?: string;
  processKey?: string;
  dependsOn: string[];
  result: MapResult;
  gaps: unknown[];
  services: Array<{ ref: string; title: string; result: MapResult }>;
};
export type MapData = { namespaces: string[]; models: unknown[]; domains: MapDomain[]; processes: MapProcess[] };
export type ImpactData = { entity: string; delivers: unknown; processes: Array<{ ref: string; title: string; namespace: string; criticality: MapCriticality; needs: { rpo: string | null; rto: string | null }; through: string[]; result: MapResult; gap?: unknown }> };

/** GET /api/business-map/map?namespace= */
export function useBusinessMap(namespace?: string) {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; data?: MapData; error?: string }>({ loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      const q = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
      const res = await fetch(`${await discovery.getBaseUrl('business-map')}/map${q}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return (await res.json()) as MapData;
    })().then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, namespace]);
  return state;
}
