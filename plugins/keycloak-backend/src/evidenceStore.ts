import type { DatabaseService } from '@backstage/backend-plugin-api';
import { canonical, digestOf, signatureOf, type ReportRow } from './evidenceModel';

/**
 * The snapshots of the report of access (Control and evidence): who was in each group of each product at a moment,
 * as text, with its SHA-256 digest and, when the platform has an evidence key, its signature. One is taken every
 * night and whenever an administrator asks; rows are only ever added, so the report of a past date can be shown
 * exactly as it was, and a row changed afterwards no longer matches its signature.
 *
 * The table is created at start if missing; a change of its shape needs a migration.
 */
type Knex = Awaited<ReturnType<DatabaseService['getClient']>>;

export const SNAPSHOTS_TABLE = 'access_snapshots';
/** two years of nightly snapshots */
export const KEEP_DAYS = 730;

export type Snapshot = { id: number; at: string; takenBy: string; digest: string; signature?: string; groups: number; people: number };
export type SnapshotWithText = Snapshot & { text: string };

export async function ensureSnapshotsTable(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(SNAPSHOTS_TABLE)) return;
  await knex.schema.createTable(SNAPSHOTS_TABLE, t => {
    t.increments('id').primary();
    t.timestamp('at', { useTz: true }).notNullable().index('access_snapshots_at_idx');
    t.string('taken_by', 255).notNullable();
    t.text('report', 'longtext').notNullable();
    t.string('digest', 64).notNullable();
    t.string('signature', 64);
    t.integer('groups').notNullable();
    t.integer('people').notNullable();
  });
}

const iso = (v: unknown) => (v instanceof Date ? v : new Date(v as string | number)).toISOString();
const snapshot = (r: Record<string, unknown>): Snapshot => ({
  id: Number(r.id),
  at: iso(r.at),
  takenBy: String(r.taken_by),
  digest: String(r.digest),
  signature: r.signature ? String(r.signature) : undefined,
  groups: Number(r.groups),
  people: Number(r.people),
});

export class EvidenceStore {
  constructor(
    private readonly knex: Knex,
    private readonly key?: string,
  ) {}

  /** Keeps the report as it is now, digested and signed. `takenBy`: an entity ref, or `system` for the nightly one. */
  async take(rows: ReportRow[], takenBy: string, now = new Date()): Promise<Snapshot> {
    const text = canonical(rows);
    const at = now.toISOString();
    const digest = digestOf(text);
    const signature = signatureOf(digest, at, this.key);
    const people = new Set(rows.flatMap(r => r.members)).size;
    const [inserted] = await this.knex(SNAPSHOTS_TABLE)
      .insert({ at: now, taken_by: takenBy, report: text, digest, signature: signature ?? null, groups: rows.length, people })
      .returning('id');
    const id = typeof inserted === 'object' ? Number((inserted as { id: number }).id) : Number(inserted);
    return { id, at, takenBy, digest, signature, groups: rows.length, people };
  }

  /** the snapshots kept, the most recent first, without their text */
  async list(limit = KEEP_DAYS): Promise<Snapshot[]> {
    const rows = await this.knex(SNAPSHOTS_TABLE).select('id', 'at', 'taken_by', 'digest', 'signature', 'groups', 'people').orderBy('at', 'desc').orderBy('id', 'desc').limit(limit);
    return rows.map(snapshot);
  }

  async get(id: number): Promise<SnapshotWithText | undefined> {
    const found = await this.knex(SNAPSHOTS_TABLE).where({ id }).first();
    return found ? { ...snapshot(found), text: String(found.report) } : undefined;
  }

  /** whether a snapshot was taken since a moment (the nightly one is not repeated after a restart) */
  async takenSince(since: Date, takenBy: string): Promise<boolean> {
    return Boolean(await this.knex(SNAPSHOTS_TABLE).where('at', '>=', since).where({ taken_by: takenBy }).first());
  }

  /** deletes the snapshots older than KEEP_DAYS; how many */
  async prune(now = new Date()): Promise<number> {
    return this.knex(SNAPSHOTS_TABLE).where('at', '<', new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000)).delete();
  }
}
