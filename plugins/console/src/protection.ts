/**
 * Data continuity of the applications (backend plugin protection of packages/backend): Longhorn snapshots and
 * Velero backups by protection plan. Types of GET /api/protection, the hook that reads it and what the pages share.
 */
import { configApiRef, discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useCallback, useEffect, useState } from 'react';
import type { Tone } from './components/ui';

export type Plan = {
  title?: string;
  description?: string;
  snapshot?: { cron: string; retain: number };
  backup?: { cron: string; ttl: string };
  weekly?: { cron: string; ttl: string };
  volumes?: boolean;
};
export type Store = { kind: string; url: string; bucket: string; region?: string; inCluster: boolean; next?: { url?: string; bucket?: string }; phase?: string; validated?: string; message?: string };
export type Backup = { name: string; schedule?: string; location?: string; phase: string; started?: string; completed?: string; expires?: string; errors: number; warnings: number; bytes: number; withVolumes: boolean };
export type Volume = { name: string; volume?: string; bytes: number; storageClass?: string; snapshots: number; snapshotBytes: number; lastSnapshot?: string };
export type AppState = 'ok' | 'late' | 'failed' | 'never' | 'noplan' | 'store';
export type App = {
  app: string;
  namespace: string;
  plan: string;
  holdsStore: boolean;
  state: AppState;
  lateHours?: number;
  volumes: Volume[];
  volumeBytes: number;
  snapshotBytes: number;
  lastSnapshot?: string;
  snapshotTimes: string[];
  lastBackup?: string;
  backupBytes: number;
  backups: Backup[];
};
export type Protection = { available: boolean; reason?: string; store?: Store; plans: Record<string, Plan>; apps: App[]; may: boolean; groups: string[]; repo: string; path: string; url: string };
export type PlanAnswer = { pull: { number: number; url: string }; version: string; changed: Array<{ app: string; from: string; to: string }> };

export const STATE_TONE: Record<AppState, Tone> = { ok: 'pos', late: 'neg', failed: 'neg', never: 'warn', noplan: 'warn', store: 'warn' };
export function planTone(plan: string): Tone {
  if (plan === 'none') return 'warn';
  return plan === 'critical' ? 'info' : 'neu';
}

const GIB = 2 ** 30;
/** "1,6 GiB", "310 MiB"; "—" for nothing */
export function size(bytes: number | undefined, lang: string): string {
  if (!bytes) return '—';
  const [v, unit] = bytes >= GIB ? [bytes / GIB, 'GiB'] : [bytes / 2 ** 20, 'MiB'];
  return `${v.toLocaleString(lang, { maximumFractionDigits: v >= 100 ? 0 : 1 })} ${unit}`;
}

/** "today 02:04", "yesterday 02:04", "3 days ago", or the date */
export function when(iso: string | undefined, t: (k: string, v?: Record<string, string | number>) => string, lang: string, now = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = (x: Date) => Math.floor((x.getTime() - x.getTimezoneOffset() * 60_000) / 86_400_000);
  const days = day(now) - day(d);
  const time = d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  if (days <= 0) return t('dp.when.today', { time });
  if (days === 1) return t('dp.when.yesterday', { time });
  if (days < 7) return t('dp.when.days', { n: days });
  return d.toLocaleDateString(lang);
}

/** a cron line in words, for the schedules the chart uses; the line itself when it is another */
export function schedule(cron: string | undefined, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (!cron) return t('dp.cron.none');
  const [m, h, dom, mon, dow] = cron.trim().split(/\s+/);
  const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UTC`;
  if (dom !== '*' || mon !== '*') return cron;
  const every = /^\*\/(\d+)$/.exec(h ?? '');
  if (every && dow === '*') return t('dp.cron.hours', { n: every[1] });
  if (!/^\d+$/.test(h ?? '') || !/^\d+$/.test(m ?? '')) return cron;
  if (dow === '*') return t('dp.cron.daily', { time });
  if (/^[0-6]$/.test(dow ?? '')) return t('dp.cron.weekly', { time, day: t(`dp.day.${dow}`) });
  return cron;
}

/** "336h" -> days kept */
export const keptDays = (ttl: string | undefined) => {
  const m = /^(\d+)h/.exec(ttl ?? '');
  return m ? Math.round(Number(m[1]) / 24) : undefined;
};

export type ProtectionPrices = { snapshot?: number; backup?: number; currency: string };
/** what the snapshots and the backups of an application cost a month; undefined without prices */
export function monthlyCost(app: Pick<App, 'snapshotBytes' | 'backupBytes'>, p: ProtectionPrices) {
  if (p.snapshot === undefined && p.backup === undefined) return undefined;
  const snapshots = (app.snapshotBytes / GIB) * (p.snapshot ?? 0);
  const backups = (app.backupBytes / GIB) * (p.backup ?? 0);
  return { snapshots, backups, total: snapshots + backups };
}

export function useProtectionPrices(): ProtectionPrices {
  const config = useApi(configApiRef);
  return {
    snapshot: config.getOptionalNumber('opencost.pricing.protection.snapshotPerGiBMonth'),
    backup: config.getOptionalNumber('opencost.pricing.protection.backupPerGiBMonth'),
    currency: config.getOptionalString('opencost.currency') ?? 'EUR',
  };
}

export function useProtection() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; data?: Protection; error?: string }>({ loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(await discovery.getBaseUrl('protection'));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
      return body as Protection;
    })().then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch]);
  const post = useCallback(
    async (changes: Record<string, string>): Promise<PlanAnswer> => {
      const res = await fetch(`${await discovery.getBaseUrl('protection')}/plans`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
      return body as PlanAnswer;
    },
    [discovery, fetch],
  );
  return { ...state, post };
}
