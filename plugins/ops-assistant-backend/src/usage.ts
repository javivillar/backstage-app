/**
 * What the assistants consume, to charge it in the costs (page /costs): one row per question answered, with who asked
 * it (the Backstage user, signed in with Keycloak), which assistant, which runner and model, the tokens the model
 * reported, how long it took, and what the question was about, so that its cost is charged to that system.
 *
 * What it was about (the page /costs resolves it with the catalog):
 *   - system      the system the user chose in the page (or the page was opened from); when set, it is the one charged
 *   - systems     the systems the tools were asked about (argument `system`: functional, architect, developer, sec)
 *   - namespaces  the namespaces the tools looked at (argument `namespace`: ops, sec), a system through the catalog
 *   - components  the projects the tools looked at (argument `project`: sec), a system through the catalog
 *   Nothing of that: the platform.
 *
 * The tokens are what the model said it used: Anthropic (input, output, cache read and write), a local model through
 * an OpenAI-compatible server (prompt and completion; 0 when the server does not say: `reported` false). The price is
 * not here: the page computes it with opencost.pricing.assistants (per token, or per hour of a local server).
 *
 * A question cancelled or failed is not recorded (the model does not report what it used). Kept `retentionDays`
 * (assistantUsage.retentionDays, default 400: the months of a year to compare), then deleted by a daily task. The
 * table is created at start if missing (as conversations.ts).
 */
import type { Knex } from 'knex';
import type { ToolCallRecord } from './agent';

export const USAGE_TABLE = 'assistant_usage';
/** what was recorded from outside a question (a run of the developer workflow): each one once */
export const SOURCES_TABLE = 'assistant_usage_sources';
export const DEFAULT_USAGE_RETENTION_DAYS = 400;
/** a system, a namespace or a project name, as the catalog and Kubernetes name them */
export const SUBJECT = /^[a-z0-9]([a-z0-9._-]{0,251}[a-z0-9])?$/;
/** at most this many of each kind per question: more is noise, and the column stays small */
const MAX_SUBJECTS = 20;

export type Subjects = { systems: string[]; namespaces: string[]; components: string[] };

export type UsageRow = {
  at: Date;
  assistant: string;
  user: string;
  runner: string;
  model: string;
  system?: string;
  subjects: Subjects;
  usage: Record<string, number>;
  ms: number;
  tools: number;
};

/** one line of the month: the questions of one user to one assistant with one model about the same subjects */
export type UsageGroup = {
  assistant: string;
  /** undefined: someone else's, and the caller may not see who */
  user?: string;
  runner: string;
  model: string;
  system?: string;
  systems: string[];
  namespaces: string[];
  components: string[];
  questions: number;
  /** questions whose model reported no tokens (a local server that does not say) */
  unreported: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  ms: number;
};

export type MonthUsage = { month: string; all: boolean; groups: UsageGroup[] };

/** "acme/Petstore" -> "petstore"; "system:default/petstore" -> "petstore"; undefined when it is no name */
export function subjectName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const name = v.trim().toLocaleLowerCase('en-US').split('/').pop()!.replace(/^[a-z]+:/, '');
  return SUBJECT.test(name) ? name : undefined;
}

/** what the tools of a question were asked about */
export function subjectsOf(calls: ToolCallRecord[]): Subjects {
  const out = { systems: new Set<string>(), namespaces: new Set<string>(), components: new Set<string>() };
  for (const c of calls) {
    const input = c.input ?? {};
    const add = (set: Set<string>, v: unknown) => {
      const n = subjectName(v);
      if (n && set.size < MAX_SUBJECTS) set.add(n);
    };
    add(out.systems, input.system);
    add(out.namespaces, input.namespace);
    add(out.components, input.project);
  }
  return { systems: [...out.systems].sort(), namespaces: [...out.namespaces].sort(), components: [...out.components].sort() };
}

export async function ensureUsageTable(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable(SOURCES_TABLE))) {
    await knex.schema.createTable(SOURCES_TABLE, t => {
      t.string('source', 255).primary();
      t.timestamp('at', { useTz: true }).notNullable();
    });
  }
  if (await knex.schema.hasTable(USAGE_TABLE)) return;
  await knex.schema.createTable(USAGE_TABLE, t => {
    t.increments('id');
    t.timestamp('at', { useTz: true }).notNullable();
    t.string('assistant', 16).notNullable();
    t.string('user_ref', 255).notNullable();
    t.string('runner', 32).notNullable();
    t.string('model', 128).notNullable();
    t.string('system', 253);
    // JSON arrays, sorted: the same subjects group together
    t.text('systems').notNullable();
    t.text('namespaces').notNullable();
    t.text('components').notNullable();
    t.bigInteger('input').notNullable();
    t.bigInteger('output').notNullable();
    t.bigInteger('cache_read').notNullable();
    t.bigInteger('cache_write').notNullable();
    t.boolean('reported').notNullable();
    t.integer('ms').notNullable();
    t.integer('tools').notNullable();
    t.index(['at'], 'assistant_usage_at_idx');
  });
}

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? Math.round(x) : 0;
};

/** "2026-10" -> [1 Oct, 1 Nov) in UTC; undefined when it is not YYYY-MM */
export function monthRange(month: string): [Date, Date] | undefined {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return [new Date(Date.UTC(y, mo, 1)), new Date(Date.UTC(y, mo + 1, 1))];
}

export const currentMonth = (now = new Date()) => now.toISOString().slice(0, 7);

export class UsageStore {
  constructor(private readonly knex: Knex) {}

  async record(r: UsageRow, db: Knex = this.knex): Promise<void> {
    const u = r.usage ?? {};
    const input = n(u.input);
    const output = n(u.output);
    await db(USAGE_TABLE).insert({
      at: r.at,
      assistant: r.assistant,
      user_ref: r.user.slice(0, 255),
      runner: r.runner.slice(0, 32),
      model: (r.model || 'unknown').slice(0, 128),
      system: r.system ?? null,
      systems: JSON.stringify(r.subjects.systems),
      namespaces: JSON.stringify(r.subjects.namespaces),
      components: JSON.stringify(r.subjects.components),
      input,
      output,
      cache_read: n(u.cacheRead),
      cache_write: n(u.cacheWrite),
      reported: input + output > 0,
      ms: n(r.ms),
      tools: n(r.tools),
    });
  }

  /**
   * The month grouped; `viewer` sees who asked only their own questions, unless `all` (then everyone's). The totals
   * by system and assistant are the same for everyone: that is what is charged.
   */
  async month(month: string, viewer: string, all: boolean): Promise<MonthUsage | undefined> {
    const range = monthRange(month);
    if (!range) return undefined;
    const rows = await this.knex(USAGE_TABLE)
      .select('assistant', 'user_ref', 'runner', 'model', 'system', 'systems', 'namespaces', 'components')
      .count({ questions: '*' })
      .sum({ input: 'input', output: 'output', cache_read: 'cache_read', cache_write: 'cache_write', ms: 'ms' })
      .select(this.knex.raw('sum(case when reported then 0 else 1 end) as unreported'))
      .where('at', '>=', range[0])
      .andWhere('at', '<', range[1])
      .groupBy('assistant', 'user_ref', 'runner', 'model', 'system', 'systems', 'namespaces', 'components');
    const parse = (s: unknown): string[] => {
      try {
        const v = JSON.parse(String(s));
        return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
      } catch {
        return [];
      }
    };
    const groups: UsageGroup[] = rows.map((r: any) => ({
      assistant: r.assistant,
      user: all || r.user_ref === viewer ? r.user_ref : undefined,
      runner: r.runner,
      model: r.model,
      system: r.system ?? undefined,
      systems: parse(r.systems),
      namespaces: parse(r.namespaces),
      components: parse(r.components),
      questions: n(r.questions),
      unreported: n(r.unreported),
      input: n(r.input),
      output: n(r.output),
      cacheRead: n(r.cache_read),
      cacheWrite: n(r.cache_write),
      ms: n(r.ms),
    }));
    return { month, all, groups };
  }

  /** whether a source (e.g. a run of a workflow) was already recorded */
  async seen(source: string): Promise<boolean> {
    return !!(await this.knex(SOURCES_TABLE).where({ source }).first());
  }

  /** records the rows of a source once: false (and nothing recorded) when it was already */
  async recordSource(source: string, rows: UsageRow[], now = new Date()): Promise<boolean> {
    return this.knex.transaction(async tx => {
      if (await tx(SOURCES_TABLE).where({ source }).first()) return false;
      await tx(SOURCES_TABLE).insert({ source: source.slice(0, 255), at: now });
      for (const r of rows) await this.record(r, tx);
      return true;
    });
  }

  /** deletes the rows older than `days`; how many */
  async purge(days: number, now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - days * 24 * 3600 * 1000);
    await this.knex(SOURCES_TABLE).where('at', '<', before).delete();
    return this.knex(USAGE_TABLE).where('at', '<', before).delete();
  }
}
