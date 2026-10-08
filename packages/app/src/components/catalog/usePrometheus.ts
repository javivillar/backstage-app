import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useEffect, useState } from 'react';

export type PromSample = { metric: Record<string, string>; value: number };

/**
 * Runs instant PromQL queries through the backend proxy (`/api/proxy/prometheus`, declared in
 * app-config: proxy.endpoints./prometheus). One result list per named query.
 */
export function usePrometheus(queries: Record<string, string>) {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const key = JSON.stringify(queries);
  const [state, setState] = useState<{ loading: boolean; value?: Record<string, PromSample[]>; error?: Error }>({ loading: true });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    (async () => {
      const base = `${await discoveryApi.getBaseUrl('proxy')}/prometheus/api/v1/query`;
      const out: Record<string, PromSample[]> = {};
      await Promise.all(
        Object.entries(JSON.parse(key) as Record<string, string>).map(async ([name, query]) => {
          const res = await fetchApi.fetch(`${base}?query=${encodeURIComponent(query)}`);
          if (!res.ok) throw new Error(`Prometheus answered ${res.status}`);
          const body = await res.json();
          out[name] = (body?.data?.result ?? []).map((r: any) => ({
            metric: r.metric ?? {},
            value: Number(r.value?.[1]),
          }));
        }),
      );
      return out;
    })().then(
      value => !cancelled && setState({ loading: false, value }),
      error => !cancelled && setState({ loading: false, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [key, discoveryApi, fetchApi]);
  return state;
}

export const NAMESPACE_ANNOTATION = 'refresquito.io/namespace';
