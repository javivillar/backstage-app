import { configApiRef, discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
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
};

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
  };
}

/** "0.0205 €/vCPU·h · 0.0027 €/GiB·h of memory · 0.0001 €/GiB·h of disk · 0.5 €/deployment" */
export function describePrices(p: Pricing) {
  const parts = [
    p.cpuPerCoreHour !== undefined ? `${p.cpuPerCoreHour} ${p.currency}/vCPU·h` : undefined,
    p.ramPerGiBHour !== undefined ? `${p.ramPerGiBHour} ${p.currency}/GiB·h of memory` : undefined,
    p.storagePerGiBHour !== undefined ? `${p.storagePerGiBHour} ${p.currency}/GiB·h of disk` : undefined,
    p.perDeployment !== undefined ? `${p.perDeployment} ${p.currency}/deployment` : undefined,
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
