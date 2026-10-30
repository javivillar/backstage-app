import { configApiRef, discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { keycloakOIDCAuthApiRef } from '@internal/plugin-keycloak';
import { SUPPORT_APPLICATION, supportUrl } from '../catalog/EntitySupportContent';
import { useEffect, useState } from 'react';

/**
 * What a namespace cost in a window, as OpenCost computes it (GET /allocation/compute, aggregate=namespace,
 * accumulate=true), read through the proxy /api/proxy/opencost of app-config (chart cnoe-oneke, templates/opencost.yaml).
 * The prices are ours (app-config opencost.pricing), not a bill: the page always says so.
 */
export type Allocation = {
  namespace: string;
  /** the cost of the window, in the currency of opencost.currency */
  total: number;
  cpu: number;
  ram: number;
  disk: number;
  /** average cores and bytes reserved (requests) and used in the window */
  cpuRequested: number;
  cpuUsed: number;
  ramRequested: number;
  ramUsed: number;
  /** minutes of the window it ran */
  minutes: number;
};

/** OpenCost's names for what is not any namespace: capacity of the nodes nobody reserved, and the rest */
export const IDLE = '__idle__';
export const UNALLOCATED = '__unallocated__';

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** the namespaces of an answer of /allocation/compute?aggregate=namespace&accumulate=true */
export function parseAllocations(body: any): Map<string, Allocation> {
  const out = new Map<string, Allocation>();
  const sets: unknown[] = Array.isArray(body?.data) ? body.data : [];
  for (const set of sets) {
    if (!set || typeof set !== 'object') continue;
    for (const [name, a] of Object.entries(set as Record<string, any>)) {
      if (!a || typeof a !== 'object') continue;
      const prev = out.get(name);
      const next: Allocation = {
        namespace: name,
        total: num(a.totalCost),
        cpu: num(a.cpuCost),
        ram: num(a.ramCost),
        disk: num(a.pvCost),
        cpuRequested: num(a.cpuCoreRequestAverage),
        cpuUsed: num(a.cpuCoreUsageAverage),
        ramRequested: num(a.ramByteRequestAverage),
        ramUsed: num(a.ramByteUsageAverage),
        minutes: num(a.minutes),
      };
      // more than one set (not accumulated): add them up
      out.set(
        name,
        prev
          ? {
              ...next,
              total: prev.total + next.total,
              cpu: prev.cpu + next.cpu,
              ram: prev.ram + next.ram,
              disk: prev.disk + next.disk,
              minutes: prev.minutes + next.minutes,
            }
          : next,
      );
    }
  }
  return out;
}

/** used / reserved, as a percentage; undefined when nothing is reserved */
export const efficiency = (used: number, requested: number) => (requested > 0 ? (used / requested) * 100 : undefined);

/** a month at the pace of the last 24 hours */
export const perMonth = (day?: Allocation) => (day ? day.total * 30.4 : undefined);

export const GiB = 1024 ** 3;

export function money(value: number | undefined, currency: string) {
  if (value === undefined || !Number.isFinite(value)) return '—';
  const digits = Math.abs(value) < 10 ? 2 : 0;
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency}`;
  }
}

export const pct = (v: number | undefined) => (v === undefined ? '—' : `${v.toFixed(0)} %`);

export type Pricing = {
  currency: string;
  description?: string;
  cpuPerCoreHour?: number;
  ramPerGiBHour?: number;
  storagePerGiBHour?: number;
  /** what each deployment (a new version of an image in the namespace) costs */
  perDeployment?: number;
  /** what each incident opened on an element of the namespace costs, by its priority */
  perIncident?: ByPriority;
};

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export type Priority = (typeof PRIORITIES)[number];
/** a number for each priority: how many incidents, or the price of one */
export type ByPriority = Partial<Record<Priority, number>>;

function perIncidentOf(c?: { getOptionalNumber(key: string): number | undefined }): ByPriority | undefined {
  if (!c) return undefined;
  const prices: ByPriority = {};
  for (const p of PRIORITIES) {
    const v = c.getOptionalNumber(p);
    if (v !== undefined) prices[p] = v;
  }
  return Object.keys(prices).length ? prices : undefined;
}

/** the currency and the prices (app-config opencost); EUR when not configured */
export function usePricing(): Pricing {
  const config = useApi(configApiRef);
  const c = config.getOptionalConfig('opencost');
  return {
    currency: c?.getOptionalString('currency') ?? 'EUR',
    description: c?.getOptionalString('pricing.description'),
    cpuPerCoreHour: c?.getOptionalNumber('pricing.cpuPerCoreHour'),
    ramPerGiBHour: c?.getOptionalNumber('pricing.ramPerGiBHour'),
    storagePerGiBHour: c?.getOptionalNumber('pricing.storagePerGiBHour'),
    perDeployment: c?.getOptionalNumber('pricing.perDeployment'),
    perIncident: perIncidentOf(c?.getOptionalConfig('pricing.perIncident')),
  };
}

/** "0.0205 €/vCPU·h · 0.0027 €/GiB·h of memory · 0.0001 €/GiB·h of disk · 0.5 €/deployment" */
export function describePrices(p: Pricing) {
  const parts = [
    p.cpuPerCoreHour !== undefined ? `${p.cpuPerCoreHour} ${p.currency}/vCPU·h` : undefined,
    p.ramPerGiBHour !== undefined ? `${p.ramPerGiBHour} ${p.currency}/GiB·h of memory` : undefined,
    p.storagePerGiBHour !== undefined ? `${p.storagePerGiBHour} ${p.currency}/GiB·h of disk` : undefined,
    p.perDeployment !== undefined ? `${p.perDeployment} ${p.currency}/deployment` : undefined,
    p.perIncident
      ? `${PRIORITIES.filter(k => p.perIncident![k] !== undefined).map(k => `${k} ${p.perIncident![k]}`).join(' / ')} ${p.currency}/incident`
      : undefined,
  ].filter(Boolean);
  return parts.join(' · ');
}

/** the cost of every namespace in the last 7 days and in the last 24 hours */
export function useAllocations() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{
    loading: boolean;
    week?: Map<string, Allocation>;
    day?: Map<string, Allocation>;
    error?: Error;
  }>({ loading: true });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const base = `${await discovery.getBaseUrl('proxy')}/opencost/allocation/compute`;
      const get = async (window: string) => {
        const res = await fetch(`${base}?window=${window}&aggregate=namespace&accumulate=true`);
        if (!res.ok) throw new Error(`OpenCost answered ${res.status} ${res.statusText}`);
        return parseAllocations(await res.json());
      };
      const [week, day] = await Promise.all([get('7d'), get('24h')]);
      return { week, day };
    })().then(
      v => !cancelled && setState({ loading: false, ...v }),
      error => !cancelled && setState({ loading: false, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [discovery, fetch]);
  return state;
}

/**
 * The deployments of a month (backend plugin costs of packages/backend: a new version of an image in a namespace, kept
 * in the database of Backstage). What is deployed is charged at pricing.perDeployment.
 */
export type NamespaceDeployments = { count: number; versions: { image: string; firstSeen: string }[] };
export type MonthDeployments = { month: string; trackedSince?: string; byNamespace: Map<string, NamespaceDeployments> };

export function parseDeployments(body: any): MonthDeployments {
  const byNamespace = new Map<string, NamespaceDeployments>();
  for (const [ns, d] of Object.entries((body?.namespaces ?? {}) as Record<string, any>)) {
    const versions = Array.isArray(d?.versions) ? d.versions.filter((v: any) => typeof v?.image === 'string') : [];
    byNamespace.set(ns, { count: num(d?.count), versions });
  }
  return {
    month: typeof body?.month === 'string' ? body.month : '',
    trackedSince: typeof body?.trackedSince === 'string' ? body.trackedSince : undefined,
    byNamespace,
  };
}

/** what the deployments of a namespace cost; undefined without a price */
export const deploymentsCost = (count: number | undefined, p: Pricing) =>
  p.perDeployment === undefined ? undefined : (count ?? 0) * p.perDeployment;

/** the deployments of the current month; error when they are not counted (the page then shows the rest) */
export function useDeployments() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; value?: MonthDeployments; error?: Error }>({ loading: true });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`${await discovery.getBaseUrl('costs')}/deployments`);
      if (!res.ok) throw new Error(`the deployments answered ${res.status} ${res.statusText}`);
      return parseDeployments(await res.json());
    })().then(
      value => !cancelled && setState({ loading: false, value }),
      error => !cancelled && setState({ loading: false, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [discovery, fetch]);
  return state;
}

/**
 * The incidents opened this month on each element of the catalog, by priority: the application support
 * (GET /api/costs/incidents), read in the browser with the Keycloak token of the person, as the tab Incidents does.
 * Each one is charged to the namespace of its element at pricing.perIncident of its priority.
 */
export function parseIncidentCounts(body: any): Map<string, ByPriority> {
  const out = new Map<string, ByPriority>();
  const rows: unknown[] = Array.isArray(body?.elements) ? body.elements : [];
  for (const row of rows as any[]) {
    const ref = typeof row?.ref === 'string' ? row.ref.toLocaleLowerCase('en-US') : '';
    const p = row?.priority as Priority;
    if (!ref || !PRIORITIES.includes(p)) continue;
    const counts = out.get(ref) ?? {};
    counts[p] = (counts[p] ?? 0) + num(row?.count);
    out.set(ref, counts);
  }
  return out;
}

export const addCounts = (a: ByPriority, b: ByPriority): ByPriority => {
  const out: ByPriority = { ...a };
  for (const p of PRIORITIES) if (b[p]) out[p] = (out[p] ?? 0) + b[p]!;
  return out;
};

export const incidentCount = (c?: ByPriority) => PRIORITIES.reduce((s, p) => s + (c?.[p] ?? 0), 0);

/** what the incidents cost at the price of their priority; undefined without prices (a priority without price: 0) */
export const incidentsCost = (c: ByPriority | undefined, p: Pricing) =>
  p.perIncident === undefined ? undefined : PRIORITIES.reduce((s, k) => s + (c?.[k] ?? 0) * (p.perIncident![k] ?? 0), 0);

/** "P1 1 · P3 2" */
export const describeCounts = (c?: ByPriority) =>
  PRIORITIES.filter(p => c?.[p]).map(p => `${p} ${c![p]}`).join(' · ');

/** the incidents of this month by element (lowercase reference); error when the support cannot be read */
export function useIncidentCounts() {
  const catalog = useApi(catalogApiRef);
  const keycloak = useApi(keycloakOIDCAuthApiRef);
  const [state, setState] = useState<{ loading: boolean; value?: Map<string, ByPriority>; error?: Error }>({ loading: true });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { items } = await catalog.getEntities({
        filter: { kind: 'component', 'metadata.annotations.refresquito.io/application': SUPPORT_APPLICATION },
        fields: ['kind', 'metadata.name', 'metadata.namespace', 'metadata.annotations'],
      });
      const base = supportUrl(items);
      if (!base) throw new Error('the support is not deployed');
      const token = await keycloak.getAccessToken(undefined, { optional: true });
      if (!token) throw new Error('sign in with Keycloak to read the incidents');
      const res = await fetch(`${base}/api/costs/incidents`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`the support answered ${res.status}`);
      return parseIncidentCounts(await res.json());
    })().then(
      value => !cancelled && setState({ loading: false, value }),
      error =>
        !cancelled &&
        setState({ loading: false, error: error instanceof TypeError ? new Error('the support could not be reached') : error }),
    );
    return () => {
      cancelled = true;
    };
  }, [catalog, keycloak]);
  return state;
}
