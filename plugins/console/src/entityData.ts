import { configApiRef, discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useEffect, useState } from 'react';

/** The cost of one namespace: the week by parts and day by day (OpenCost through the proxy /opencost, our prices). */
export type NamespaceWeek = { total: number; cpu: number; ram: number; disk: number; days: number[] };

export function parseWeek(accumulated: unknown, daily: unknown, ns: string): NamespaceWeek | undefined {
  const sets = (b: unknown) => (Array.isArray((b as { data?: unknown[] })?.data) ? ((b as { data: unknown[] }).data as Array<Record<string, any>>) : []);
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  let a: Record<string, any> | undefined;
  for (const s of sets(accumulated)) if (s && s[ns]) a = s[ns];
  if (!a) return undefined;
  const days = sets(daily).map(s => n(s?.[ns]?.totalCost));
  return { total: n(a.totalCost), cpu: n(a.cpuCost), ram: n(a.ramCost), disk: n(a.pvCost), days };
}

export function useNamespaceWeek(ns?: string) {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const currency = useApi(configApiRef).getOptionalString('opencost.currency') ?? 'EUR';
  const [state, setState] = useState<{ loading: boolean; week?: NamespaceWeek; error?: string }>({ loading: !!ns });
  useEffect(() => {
    if (!ns) return undefined;
    let alive = true;
    const get = async (query: string) => {
      const r = await fetch(`${await discovery.getBaseUrl('proxy')}/opencost/allocation/compute?window=7d&aggregate=namespace&${query}`);
      if (!r.ok) throw new Error(`OpenCost answered ${r.status}`);
      return r.json();
    };
    // the week first (the query the Costs page makes); the days are slower for OpenCost: added when they come
    get('accumulate=true').then(
      acc => {
        if (!alive) return;
        setState({ loading: false, week: parseWeek(acc, null, ns) });
        get('accumulate=false&step=1d').then(
          daily => {
            const week = parseWeek(acc, daily, ns);
            if (alive && week) setState({ loading: false, week });
          },
          () => undefined,
        );
      },
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, ns]);
  const money = (v: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(v);
  return { ...state, money };
}

/** The image versions deployed in a namespace, newest first (the deployments the costs count, two months). */
export type Change = { image: string; at: string };

export function parseChanges(months: unknown[], ns: string): Change[] {
  const out: Change[] = [];
  for (const m of months) {
    const versions = (m as { namespaces?: Record<string, { versions?: Array<{ image: string; firstSeen: string }> }> })?.namespaces?.[ns]?.versions ?? [];
    for (const v of versions) out.push({ image: v.image, at: v.firstSeen });
  }
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter(c => {
      const k = `${c.image}@${c.at}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

const monthOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

export function useNamespaceChanges(ns?: string) {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; changes?: Change[]; since?: string; error?: string }>({ loading: !!ns });
  useEffect(() => {
    if (!ns) return undefined;
    let alive = true;
    (async () => {
      const now = new Date();
      const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
      const base = `${await discovery.getBaseUrl('costs')}/deployments`;
      const months = await Promise.all(
        [monthOf(now), monthOf(prev)].map(async m => {
          const r = await fetch(`${base}?month=${m}`);
          if (!r.ok) throw new Error(r.status === 503 ? 'The deployments are not recorded in this portal' : `Costs answered ${r.status}`);
          return r.json();
        }),
      );
      const since = months.map(m => (m as { trackedSince?: string }).trackedSince).filter(Boolean).sort()[0];
      return { changes: parseChanges(months, ns), since };
    })().then(
      r => alive && setState({ loading: false, ...r }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, ns]);
  return state;
}

/** Vulnerabilities of each image (the scans of Wazuh through the SBOM backend). */
export type ImageFindings = { image: string; counts: Record<string, number>; kev: number; error?: string };

export function useImageFindings(images: string[]) {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const key = images.join('|');
  const [state, setState] = useState<{ loading: boolean; findings: ImageFindings[] }>({ loading: images.length > 0, findings: [] });
  useEffect(() => {
    if (!key) {
      setState({ loading: false, findings: [] });
      return undefined;
    }
    let alive = true;
    (async () => {
      const base = `${await discovery.getBaseUrl('sbom')}/vulnerabilities`;
      return Promise.all(
        key.split('|').map(async image => {
          try {
            const r = await fetch(`${base}?ref=${encodeURIComponent(image)}`);
            const b = await r.json().catch(() => ({}));
            if (!r.ok) return { image, counts: {}, kev: 0, error: b.error ?? `${r.status}` };
            const scan = b.scan as { counts?: Record<string, number>; vulns?: Array<{ kev?: boolean; in_kev?: boolean }> } | null;
            if (!scan) return { image, counts: {}, kev: 0, error: b.configured === false ? 'no scanner configured' : 'not scanned yet' };
            return { image, counts: scan.counts ?? {}, kev: (scan.vulns ?? []).filter(v => v.kev || v.in_kev).length };
          } catch (e) {
            return { image, counts: {}, kev: 0, error: (e as Error).message };
          }
        }),
      );
    })().then(findings => alive && setState({ loading: false, findings }));
    return () => {
      alive = false;
    };
  }, [discovery, fetch, key]);
  return state;
}

/** Severity totals over several images. */
export function totals(findings: ImageFindings[]) {
  const t = { critical: 0, high: 0, medium: 0, low: 0, kev: 0 };
  for (const f of findings) {
    t.critical += f.counts.CRITICAL ?? 0;
    t.high += f.counts.HIGH ?? 0;
    t.medium += f.counts.MEDIUM ?? 0;
    t.low += f.counts.LOW ?? 0;
    t.kev += f.kev;
  }
  return t;
}
