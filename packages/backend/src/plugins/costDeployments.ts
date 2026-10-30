/**
 * Deployments of each namespace, to charge them in its cost (page /costs and the Cost card): a deployment is a new
 * version of an image running in the namespace. A sweep every hour asks Prometheus which images the containers of
 * every namespace ran (kube-state-metrics, kube_pod_container_info) and keeps, in the database of Backstage, the first
 * time each one was seen. Prometheus keeps only 15 days; this table keeps the months.
 *
 * - The version is the digest the node pulled (image_id). A tag pushed again with other content is a new version too.
 *   A container still starting has no digest yet: it is skipped, and counted once it runs (keying it by its tag in the
 *   meantime counted every deployment twice, and every run of a CronJob whose pod was caught starting).
 * - Restarting or scaling a pod is not a deployment (same image). Going back to a version the namespace already ran is
 *   not either: it is counted the first time only.
 * - The first sweep ever takes what was already running as the starting point (baseline): it is not charged.
 * - After a gap (Backstage down) the sweep looks back over the gap, up to 14 days, and keeps the time each image was
 *   first seen there, not the time of the sweep.
 *
 * The tables are created at start if missing (as conversations.ts of ops-assistant-backend does).
 */
import type { Knex } from 'knex';

export const TABLE = 'cost_deployments';
export const META = 'cost_deployments_meta';

const HOUR = 3600;
const MAX_LOOKBACK = 14 * 24 * HOUR;

export type Seen = { namespace: string; version: string; image: string; firstSeen: Date };
export type Version = { image: string; firstSeen: string };
export type MonthDeployments = {
  month: string;
  /** when the first sweep ran: deployments before it are not known */
  trackedSince?: string;
  namespaces: Record<string, { count: number; versions: Version[] }>;
};

export async function ensureTables(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, t => {
      t.string('namespace', 253).notNullable();
      t.string('version', 512).notNullable();
      t.string('image', 512).notNullable();
      t.timestamp('first_seen', { useTz: true }).notNullable();
      t.boolean('baseline').notNullable().defaultTo(false);
      t.primary(['namespace', 'version']);
      t.index(['first_seen'], 'cost_deployments_first_seen_idx');
    });
  }
  if (!(await knex.schema.hasTable(META))) {
    await knex.schema.createTable(META, t => {
      t.string('key', 32).primary();
      t.timestamp('at', { useTz: true }).notNullable();
    });
  }
}

/** how far back a sweep looks: an hour and some margin, or the gap since the last sweep (at most 14 days) */
export function lookback(lastSweep: Date | undefined, now: Date): { seconds: number; step: string } {
  const since = lastSweep ? (now.getTime() - lastSweep.getTime()) / 1000 + 300 : 0;
  const seconds = Math.round(Math.min(MAX_LOOKBACK, Math.max(HOUR + 300, since)));
  return { seconds, step: seconds <= 3 * HOUR ? '1m' : '5m' };
}

/** the first time, in the window, each image ran in each namespace */
export function sweepQuery(seconds: number, step: string): string {
  return `min by (namespace, image, image_spec, image_id) (min_over_time(timestamp(kube_pod_container_info)[${seconds}s:${step}]))`;
}

/** the answer of Prometheus to sweepQuery */
export function parseSweep(body: any): Seen[] {
  const result: unknown[] = Array.isArray(body?.data?.result) ? body.data.result : [];
  const out = new Map<string, Seen>();
  for (const r of result as any[]) {
    const m = r?.metric ?? {};
    const namespace = typeof m.namespace === 'string' ? m.namespace : '';
    const image = (m.image_spec || m.image || '') as string;
    const version = (m.image_id || '') as string;
    const seconds = Number(r?.value?.[1]);
    if (!namespace || !version || !Number.isFinite(seconds)) continue;
    const firstSeen = new Date(seconds * 1000);
    const key = `${namespace}\u0000${version}`;
    const prev = out.get(key);
    if (!prev || firstSeen < prev.firstSeen) out.set(key, { namespace, version, image: image || version, firstSeen });
  }
  return [...out.values()];
}

/** "2026-10" → the first instant of that month and of the next one, in UTC */
export function monthRange(month: string): [Date, Date] | undefined {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return [new Date(Date.UTC(y, mo, 1)), new Date(Date.UTC(y, mo + 1, 1))];
}

export const currentMonth = (now = new Date()) => now.toISOString().slice(0, 7);

const toDate = (v: unknown) => (v instanceof Date ? v : new Date(v as string | number));

export class DeploymentStore {
  constructor(private readonly knex: Knex) {}

  private async meta(key: string): Promise<Date | undefined> {
    const r = await this.knex(META).where({ key }).first();
    return r ? toDate(r.at) : undefined;
  }

  async lastSweep() {
    return this.meta('last');
  }

  /** keeps the versions not seen before; returns how many were new. The first sweep ever is the baseline. */
  async record(seen: Seen[], now: Date): Promise<number> {
    const first = await this.meta('first');
    const baseline = !first;
    let added = 0;
    await this.knex.transaction(async tx => {
      for (let i = 0; i < seen.length; i += 200) {
        const rows = seen.slice(i, i + 200).map(s => ({
          namespace: s.namespace,
          version: s.version.slice(0, 512),
          image: s.image.slice(0, 512),
          first_seen: s.firstSeen,
          baseline,
        }));
        const before = Number((await tx(TABLE).count({ n: '*' }).first())?.n ?? 0);
        await tx(TABLE).insert(rows).onConflict(['namespace', 'version']).ignore();
        added += Number((await tx(TABLE).count({ n: '*' }).first())?.n ?? 0) - before;
      }
      if (baseline) await tx(META).insert({ key: 'first', at: now }).onConflict('key').merge();
      await tx(META).insert({ key: 'last', at: now }).onConflict('key').merge();
    });
    return baseline ? 0 : added;
  }

  /** the deployments of a month (UTC), by namespace; the baseline is not counted */
  async month(month: string): Promise<MonthDeployments | undefined> {
    const range = monthRange(month);
    if (!range) return undefined;
    const rows = await this.knex(TABLE)
      .where({ baseline: false })
      .andWhere('first_seen', '>=', range[0])
      .andWhere('first_seen', '<', range[1])
      .orderBy('first_seen', 'asc');
    const namespaces: MonthDeployments['namespaces'] = {};
    for (const r of rows) {
      const ns = (namespaces[r.namespace] ??= { count: 0, versions: [] });
      ns.count += 1;
      ns.versions.push({ image: r.image, firstSeen: toDate(r.first_seen).toISOString() });
    }
    const since = await this.meta('first');
    return { month, trackedSince: since?.toISOString(), namespaces };
  }
}
