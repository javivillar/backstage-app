import { type Entity } from '@backstage/catalog-model';
import { createApiRef, discoveryApiRef, fetchApiRef, type OAuthApi, useApi, useApiHolder } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { useEffect, useMemo, useState } from 'react';
import { type MapData, useBusinessMap, topProcesses } from '../../businessMap';
import { useNamespaceCosts } from '../../costs';
import { type AppOverview, useClusterOverview } from '../../overview';
import { healthOf } from '../EntityDependencies';
import { useCustomer } from './BusinessMapTabs';
import { type BusinessGraph, businessGraph } from './glassModel';
import { criticalOf, type HeatSources, imagesOf, incidentsOf } from './heatmapModel';

/**
 * The data of the three dashboards: the map of the customer (useBusinessMap), the catalog under it (as the
 * Dependencies page reads it) and the cluster overview for the health; and, for the heat map, the incidents, the
 * vulnerabilities and the cost. Every source is read on its own: one that fails leaves its lens without data.
 */

const FIELDS = ['kind', 'metadata', 'spec.type', 'spec.owner', 'spec.system', 'spec.lifecycle', 'relations'];

/** ?namespace= of the URL: the customer the business map shows */
/** The customer (namespace) of the views, kept in ?ns= across the Map, Heat map, Glass and Matrix (BusinessMapTabs). */
export const useNamespaceParam = useCustomer;

const argoApp = (e: Entity, apps: AppOverview[]) => {
  const name = e.metadata.name.replace(/-oneke$/, '');
  return apps.find(x => x.name === name || x.name === `${name}-oneke` || name === `${x.name}-oneke`);
};

export type BusinessData = {
  loading: boolean;
  error?: string;
  map?: MapData;
  graph?: BusinessGraph;
  /** the cluster overview could be read (health) */
  healthKnown: boolean;
  healthLoading: boolean;
  apps: AppOverview[];
};

/** The map of a namespace and its business glass. */
export function useBusinessData(namespace?: string): BusinessData {
  const map = useBusinessMap(namespace);
  const catalog = useApi(catalogApiRef);
  const ov = useClusterOverview();
  const [entities, setEntities] = useState<{ loading: boolean; items: Entity[]; error?: string }>({ loading: true, items: [] });
  useEffect(() => {
    let alive = true;
    catalog.getEntities({ filter: [{ kind: 'component' }, { kind: 'resource' }, { kind: 'system', 'spec.type': 'business-service' }], fields: FIELDS }).then(
      r => alive && setEntities({ loading: false, items: r.items }),
      e => alive && setEntities({ loading: false, items: [], error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [catalog]);
  const apps = useMemo(() => ov.data?.apps ?? [], [ov.data]);
  // the dashboards draw the top processes; a sub-process is in the page of its parent
  const top = useMemo(() => (map.data ? topProcesses(map.data) : undefined), [map.data]);
  const graph = useMemo(
    () => (top ? businessGraph(top, entities.items, e => healthOf(e.metadata.name.replace(/-oneke$/, ''), apps)) : undefined),
    [top, entities.items, apps],
  );
  return { loading: map.loading || entities.loading, error: map.error ?? entities.error, map: top, graph, healthKnown: !!ov.data, healthLoading: ov.loading, apps };
}

/** the Keycloak sign-in of the app (plugin keycloak: id auth.keycloak-oidc), looked up by id so the console needs no new dependency */
const keycloakRef = createApiRef<OAuthApi>({ id: 'auth.keycloak-oidc' });

const STAGES = ['pro', 'pre', 'dev'];
/** where the support is: refresquito.io/url of the deployment of the application support, pro first */
function supportUrl(items: Entity[]): string | undefined {
  const url = (e: Entity) => e.metadata.annotations?.['refresquito.io/url'];
  const stage = (e: Entity) => e.metadata.annotations?.['refresquito.io/stage'] ?? 'pro';
  const best = items.filter(url).sort((a, b) => STAGES.indexOf(stage(a)) - STAGES.indexOf(stage(b)))[0];
  return best ? url(best)!.replace(/\/+$/, '') : undefined;
}

type Source<T> = { loading: boolean; value?: T; error?: string };

/** GET /api/costs/incidents of the support (this month, by element), with the Keycloak token of the person */
function useIncidents(): Source<Map<string, number>> {
  const catalog = useApi(catalogApiRef);
  const keycloak = useApiHolder().get(keycloakRef);
  const [state, setState] = useState<Source<Map<string, number>>>({ loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      const { items } = await catalog.getEntities({
        filter: { kind: 'component', 'metadata.annotations.refresquito.io/application': 'support' },
        fields: ['kind', 'metadata.name', 'metadata.namespace', 'metadata.annotations'],
      });
      const base = supportUrl(items);
      if (!base) throw new Error('the support is not deployed');
      const token = keycloak ? await keycloak.getAccessToken(undefined, { optional: true }) : '';
      if (!token) throw new Error('sign in with Keycloak to read the incidents');
      const res = await fetch(`${base}/api/costs/incidents`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`the support answered ${res.status}`);
      return incidentsOf(await res.json());
    })().then(
      value => alive && setState({ loading: false, value }),
      e => alive && setState({ loading: false, error: e instanceof TypeError ? 'the support could not be reached' : (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [catalog, keycloak]);
  return state;
}

/** GET /api/sbom/vulnerabilities?ref=<image> for each image (a few at a time): open critical ones by image */
function useCritical(images: string[]): Source<Map<string, number>> {
  const discovery = useApi(discoveryApiRef);
  const { fetch: authFetch } = useApi(fetchApiRef);
  const key = images.join(',');
  const [state, setState] = useState<Source<Map<string, number>>>({ loading: true });
  useEffect(() => {
    let alive = true;
    const list = key ? key.split(',') : [];
    (async () => {
      if (!list.length) return new Map<string, number>();
      const base = await discovery.getBaseUrl('sbom');
      const out = new Map<string, number>();
      let failed = 0;
      const one = async (image: string) => {
        try {
          const res = await authFetch(`${base}/vulnerabilities?ref=${encodeURIComponent(image)}`);
          const n = res.ok ? criticalOf(await res.json()) : undefined;
          if (n === undefined) failed += 1;
          else out.set(image, n);
        } catch {
          failed += 1;
        }
      };
      for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map(one));
      if (failed === list.length) throw new Error('the scans of Wazuh could not be read');
      return out;
    })().then(
      value => alive && setState({ loading: false, value }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, authFetch, key]);
  return state;
}

export type HeatData = { sources: HeatSources; loading: boolean; errors: Partial<Record<'health' | 'incidents' | 'vulns' | 'cost', string>>; money: (n: number) => string };

/** The sources of the heat map lenses for a business glass. */
export function useHeatSources(data: BusinessData): HeatData {
  const incidents = useIncidents();
  const images = useMemo(() => {
    const g = data.graph;
    return g ? [...new Set([...g.processes.keys()].flatMap(p => imagesOf(g, p)))].sort() : [];
  }, [data.graph]);
  const critical = useCritical(images);
  // a month at the pace of the last 24 hours, as the Costs page does
  const costs = useNamespaceCosts('24h');
  const cost = useMemo(() => (costs.costs ? new Map(costs.costs.map(c => [c.namespace, c.total * 30.4])) : undefined), [costs.costs]);
  const [now] = useState(() => Date.now());
  const { apps } = data;
  const sources: HeatSources = useMemo(
    () => ({
      health: data.healthKnown,
      incidents: incidents.value,
      critical: critical.value,
      cost,
      namespaceOf: (e: Entity) => argoApp(e, apps)?.namespace ?? e.metadata.annotations?.['backstage.io/kubernetes-namespace'],
      now,
    }),
    [data.healthKnown, incidents.value, critical.value, cost, apps, now],
  );
  return {
    sources,
    loading: incidents.loading || critical.loading || costs.loading,
    errors: {
      health: data.healthKnown || data.healthLoading ? undefined : 'the cluster overview could not be read',
      incidents: incidents.error,
      vulns: critical.error,
      cost: costs.error,
    },
    money: costs.money,
  };
}
