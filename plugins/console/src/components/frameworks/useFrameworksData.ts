import { type Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { CATALOG_FILTER_EXISTS, catalogApiRef } from '@backstage/plugin-catalog-react';
import { useEffect, useMemo, useState } from 'react';
import { useClusterOverview } from '../../overview';
import { type AppRow, type Line, STAGES, appsOf, linesOf } from './model';

/** The retrievers of sbom-backend whose facts the pages read. */
export const SUPPLY_CHAIN = 'refresquitoSupplyChainFactRetriever';
export const WEEKLY = 'refresquitoWeeklyFactRetriever';

export type FactsMap = Map<string, Record<string, unknown>>;

const FIELDS = ['kind', 'metadata.name', 'metadata.namespace', 'metadata.title', 'metadata.description', 'metadata.annotations', 'metadata.tags', 'metadata.links', 'spec', 'relations'];

/** runs fn over items with at most `limit` calls in flight */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * The lines, the applications on them and what is known of each instance: its latest supply-chain facts (Tech
 * Insights) and the health of its Argo CD application. Read once per page.
 */
export function useFrameworksData(): {
  loading: boolean;
  error?: string;
  lines: Line[];
  apps: AppRow[];
  facts: FactsMap;
  health: Map<string, string>;
  entities: Map<string, Entity>;
} {
  const catalog = useApi(catalogApiRef);
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const overview = useClusterOverview();
  const [cat, setCat] = useState<{ loading: boolean; items: Entity[]; error?: string }>({ loading: true, items: [] });
  const [facts, setFacts] = useState<{ loading: boolean; value: FactsMap }>({ loading: true, value: new Map() });

  useEffect(() => {
    let alive = true;
    catalog
      .getEntities({
        filter: [
          { kind: 'component', 'metadata.annotations.refresquito.io/framework-line': CATALOG_FILTER_EXISTS },
          // the frameworks themselves (their titles) and the lines without the annotation
          { kind: 'component', 'spec.type': ['development-service', 'framework-line'] },
          { kind: 'resource', 'metadata.annotations.refresquito.io/platform-block': CATALOG_FILTER_EXISTS },
          { kind: 'system' },
        ],
        fields: FIELDS,
      })
      .then(
        r => alive && setCat({ loading: false, items: r.items }),
        e => alive && setCat({ loading: false, items: [], error: (e as Error).message }),
      );
    return () => {
      alive = false;
    };
  }, [catalog]);

  const lines = useMemo(() => linesOf(cat.items), [cat.items]);
  const apps = useMemo(() => appsOf(cat.items, lines), [cat.items, lines]);
  const refs = useMemo(() => apps.flatMap(a => STAGES.map(s => a.instances[s]).filter((r): r is string => !!r)), [apps]);

  useEffect(() => {
    if (cat.loading) return undefined;
    let alive = true;
    (async () => {
      const base = await discovery.getBaseUrl('tech-insights');
      const got = await pool(refs, 8, async ref => {
        try {
          const r = await fetch(`${base}/facts/latest?entity=${encodeURIComponent(ref)}&ids[]=${SUPPLY_CHAIN}`);
          if (!r.ok) return [ref, undefined] as const;
          const body = (await r.json()) as Record<string, { facts?: Record<string, unknown> }>;
          return [ref, body[SUPPLY_CHAIN]?.facts] as const;
        } catch {
          // no facts: its cells say n/a
          return [ref, undefined] as const;
        }
      });
      return new Map(got.filter((x): x is readonly [string, Record<string, unknown>] => !!x[1]));
    })().then(
      value => alive && setFacts({ loading: false, value }),
      () => alive && setFacts({ loading: false, value: new Map() }),
    );
    return () => {
      alive = false;
    };
  }, [cat.loading, refs, discovery, fetch]);

  const health = useMemo(() => new Map((overview.data?.apps ?? []).map(a => [a.name, a.health])), [overview.data]);
  const entities = useMemo(() => new Map(cat.items.map(e => [stringifyEntityRef(e), e])), [cat.items]);

  return { loading: cat.loading || facts.loading, error: cat.error, lines, apps, facts: facts.value, health, entities };
}

/** the weekly facts of some instances over the last 10 weeks (retriever refresquitoWeeklyFactRetriever) */
export function useWeekly(refs: string[]): { loading: boolean; series: Map<string, Array<{ timestamp: string; facts: Record<string, unknown> }>> } {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const key = refs.join(',');
  const [state, setState] = useState<{ loading: boolean; series: Map<string, Array<{ timestamp: string; facts: Record<string, unknown> }>> }>({ loading: true, series: new Map() });
  useEffect(() => {
    const list = key ? key.split(',') : [];
    let alive = true;
    setState(s => ({ ...s, loading: true }));
    (async () => {
      const base = await discovery.getBaseUrl('tech-insights');
      const end = new Date();
      const start = new Date(end.getTime() - 70 * 86400000);
      const range = `startDatetime=${encodeURIComponent(start.toISOString())}&endDatetime=${encodeURIComponent(end.toISOString())}`;
      const got = await pool(list, 8, async ref => {
        try {
          const r = await fetch(`${base}/facts/range?entity=${encodeURIComponent(ref)}&ids[]=${WEEKLY}&${range}`);
          if (!r.ok) return [ref, []] as const;
          const body = (await r.json()) as Record<string, Array<{ timestamp: string; facts?: Record<string, unknown> }>>;
          return [ref, (body[WEEKLY] ?? []).map(p => ({ timestamp: String(p.timestamp), facts: p.facts ?? {} }))] as const;
        } catch {
          return [ref, []] as const;
        }
      });
      return new Map(got.map(([r, s]) => [r, [...s]]));
    })().then(
      series => alive && setState({ loading: false, series }),
      () => alive && setState({ loading: false, series: new Map() }),
    );
    return () => {
      alive = false;
    };
  }, [key, discovery, fetch]);
  return state;
}
