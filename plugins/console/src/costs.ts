import { configApiRef, discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useEffect, useState } from 'react';

/** What each namespace cost in a window (OpenCost /allocation/compute through the proxy /opencost, our prices). */
export type NamespaceCost = { namespace: string; total: number };

/** OpenCost's names for what is not a namespace */
const NOT_NAMESPACES = new Set(['__idle__', '__unallocated__']);

export function parseCosts(body: unknown): NamespaceCost[] {
  const sets = Array.isArray((body as { data?: unknown[] })?.data) ? (body as { data: unknown[] }).data : [];
  const out = new Map<string, number>();
  for (const set of sets) {
    if (!set || typeof set !== 'object') continue;
    for (const [name, a] of Object.entries(set as Record<string, { totalCost?: unknown }>)) {
      if (NOT_NAMESPACES.has(name) || !a || typeof a.totalCost !== 'number' || !Number.isFinite(a.totalCost)) continue;
      out.set(name, (out.get(name) ?? 0) + a.totalCost);
    }
  }
  return [...out.entries()].map(([namespace, total]) => ({ namespace, total })).sort((a, b) => b.total - a.total);
}

export function useNamespaceCosts(window = '7d') {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const config = useApi(configApiRef);
  const currency = config.getOptionalString('opencost.currency') ?? 'EUR';
  const [state, setState] = useState<{ loading: boolean; costs?: NamespaceCost[]; error?: string }>({ loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`${await discovery.getBaseUrl('proxy')}/opencost/allocation/compute?window=${window}&aggregate=namespace&accumulate=true`);
      if (!res.ok) throw new Error(`OpenCost answered ${res.status} ${res.statusText}`);
      return parseCosts(await res.json());
    })().then(
      costs => alive && setState({ loading: false, costs }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, window]);
  const money = (n: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: n < 10 ? 2 : 0 }).format(n);
  return { ...state, money };
}
