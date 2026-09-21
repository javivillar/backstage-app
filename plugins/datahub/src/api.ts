import { useCallback, useEffect, useState } from 'react';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  applicable: boolean;
  hint: string;
}

export interface Score {
  score: number;
  governed: boolean;
  threshold: number;
  checks: Check[];
}

export interface Ref {
  urn: string;
  name: string;
}

export interface Summary {
  urn: string;
  type: 'dataset' | 'dataProduct' | 'dataFlow';
  name: string;
  description?: string;
  platform?: string;
  url: string;
  domain?: Ref;
  owners: Array<Ref & { kind: 'user' | 'group'; type: string }>;
  tags: Ref[];
  terms: Ref[];
  classification?: string;
  retentionDays?: number;
  lawfulBasis?: string;
  freshnessSlaHours?: number;
  personalData: boolean;
  deprecated: boolean;
  deprecationNote?: string;
  managedBy?: string;
  columns?: { total: number; described: number };
  score: Score;
}

export interface SearchResult {
  total: number;
  start: number;
  count: number;
  items: Summary[];
  threshold: number;
}

export const TYPE_LABEL: Record<Summary['type'], string> = {
  dataset: 'Dataset',
  dataProduct: 'Data product',
  dataFlow: 'Data flow',
};

async function errorText(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body.error ?? `${res.status} ${res.statusText}`;
}

/** Calls the datahub-manager backend (read-only). Returns the parsed JSON or throws with the backend's message. */
export function useDatahubFetch() {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  return useCallback(
    async <T,>(path: string): Promise<T> => {
      const baseUrl = await discoveryApi.getBaseUrl('datahub-manager');
      const res = await fetchApi.fetch(`${baseUrl}${path}`);
      if (!res.ok) throw new Error(await errorText(res));
      return (await res.json()) as T;
    },
    [discoveryApi, fetchApi],
  );
}

export function useAssetSummary(urn: string) {
  const get = useDatahubFetch();
  const [state, setState] = useState<{ loading: boolean; error?: string; data?: Summary }>({ loading: true });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    get<Summary>(`/assets/summary?urn=${encodeURIComponent(urn)}`)
      .then(data => !cancelled && setState({ loading: false, data }))
      .catch(e => !cancelled && setState({ loading: false, error: (e as Error).message }));
    return () => {
      cancelled = true;
    };
  }, [get, urn]);
  return state;
}

export interface ImpactItem {
  urn: string;
  type: string;
  name: string;
  platform?: string;
  degree: number;
  critical: boolean;
  owners: string[];
}

export interface Impact {
  urn: string;
  total: number;
  fetched: number;
  truncated: boolean;
  byType: Record<string, number>;
  critical: number;
  directConsumers: number;
  maxDegree: number;
  owners: string[];
  items: ImpactItem[];
}

export interface Capabilities {
  canRead: boolean;
  canCreate: boolean;
  writesEnabled: boolean;
  isSteward: boolean;
}

/** What the current user may do (undefined while loading or if the call fails: buttons that need it stay hidden). */
export function useCapabilities(): Capabilities | undefined {
  const get = useDatahubFetch();
  const [caps, setCaps] = useState<Capabilities | undefined>();
  useEffect(() => {
    let cancelled = false;
    get<Capabilities>('/capabilities')
      .then(c => !cancelled && setCaps(c))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [get]);
  return caps;
}

/** Downstream impact of an asset (only meaningful for datasets; other kinds are skipped by the caller). */
export function useImpact(urn: string, enabled: boolean) {
  const get = useDatahubFetch();
  const [state, setState] = useState<{ loading: boolean; error?: string; data?: Impact }>({ loading: enabled });
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setState({ loading: true });
    get<Impact>(`/impact?urn=${encodeURIComponent(urn)}`)
      .then(data => !cancelled && setState({ loading: false, data }))
      .catch(e => !cancelled && setState({ loading: false, error: (e as Error).message }));
    return () => {
      cancelled = true;
    };
  }, [get, urn, enabled]);
  return state;
}
