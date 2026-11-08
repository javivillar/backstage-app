import { type Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { createApiRef, discoveryApiRef, fetchApiRef, type OAuthApi, useApi, useApiHolder } from '@backstage/core-plugin-api';
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

const keycloakRef = createApiRef<OAuthApi>({ id: 'auth.keycloak-oidc' });

/** where the support is: refresquito.io/url of its most stable deployment */
const supportBase = (items: Entity[]) => {
  const stage = (e: Entity) => e.metadata.annotations?.['refresquito.io/stage'] ?? 'pro';
  const best = items.filter(e => e.metadata.annotations?.['refresquito.io/url']).sort((a, b) => (STAGES as string[]).indexOf(stage(b)) - (STAGES as string[]).indexOf(stage(a)))[0];
  return best?.metadata.annotations?.['refresquito.io/url']?.replace(/\/+$/, '');
};

/**
 * The dated events of some instances for the weeks view: deployments (Argo CD history, GET /api/cluster/apps/:app)
 * and incidents (the support, GET /api/incidents?element=, with the Keycloak token of the person, as the tab
 * Incidents). Only read when asked (`on`). A source that cannot be read leaves its map without the instance (n/a).
 */
export function useEvents(on: boolean, refs: string[], argoOf: (ref: string) => string): { loading: boolean; deploys: Map<string, string[]>; incidents: Map<string, string[]>; incidentsError?: string } {
  const discovery = useApi(discoveryApiRef);
  const catalog = useApi(catalogApiRef);
  const { fetch } = useApi(fetchApiRef);
  const keycloak = useApiHolder().get(keycloakRef);
  const key = refs.join(',');
  const [state, setState] = useState<{ loading: boolean; deploys: Map<string, string[]>; incidents: Map<string, string[]>; incidentsError?: string }>({ loading: false, deploys: new Map(), incidents: new Map() });
  useEffect(() => {
    if (!on) return undefined;
    const list = key ? key.split(',') : [];
    let alive = true;
    setState(s => ({ ...s, loading: true }));
    (async () => {
      const cluster = await discovery.getBaseUrl('cluster');
      const deploys = new Map<string, string[]>();
      await pool(list, 4, async ref => {
        try {
          const r = await fetch(`${cluster}/apps/${encodeURIComponent(argoOf(ref))}`);
          if (!r.ok) return;
          const body = (await r.json()) as { history?: Array<{ deployedAt?: string }> };
          deploys.set(ref, (body.history ?? []).map(h => h.deployedAt ?? '').filter(Boolean));
        } catch {
          // n/a for this instance
        }
      });
      const incidents = new Map<string, string[]>();
      let incidentsError: string | undefined;
      try {
        const { items } = await catalog.getEntities({ filter: { kind: 'component', 'metadata.annotations.refresquito.io/application': 'support' }, fields: ['kind', 'metadata.name', 'metadata.namespace', 'metadata.annotations'] });
        const base = supportBase(items);
        const token = keycloak ? await keycloak.getAccessToken(undefined, { optional: true }) : '';
        if (!base) incidentsError = 'the support is not deployed';
        else if (!token) incidentsError = 'sign in with Keycloak to read the incidents';
        else
          await pool(list, 4, async ref => {
            const r = await window.fetch(`${base}/api/incidents?element=${encodeURIComponent(ref)}&size=200`, { headers: { Authorization: `Bearer ${token}` } });
            if (!r.ok) return;
            const body = (await r.json()) as { items?: Array<{ opened_at?: string }> } | Array<{ opened_at?: string }>;
            const rows = Array.isArray(body) ? body : body.items ?? [];
            incidents.set(ref, rows.map(i => i.opened_at ?? '').filter(Boolean));
          });
      } catch (e) {
        incidentsError = e instanceof TypeError ? 'the support could not be reached' : (e as Error).message;
      }
      return { loading: false, deploys, incidents, incidentsError };
    })().then(
      v => alive && setState(v),
      () => alive && setState({ loading: false, deploys: new Map(), incidents: new Map() }),
    );
    return () => {
      alive = false;
    };
    // argoOf is derived from the same catalog read as refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key, discovery, catalog, fetch, keycloak]);
  return state;
}
