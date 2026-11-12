import type { DatabaseService } from '@backstage/backend-plugin-api';

/**
 * The record of access administration: who added or removed whom in which Keycloak group, kept in the database of
 * this plugin (Postgres in the platform, so it is in its backups). Rows are only ever added.
 *
 * The table is created at start if missing (as the conversations of the assistants); a change of its shape needs a
 * migration.
 */
type Knex = Awaited<ReturnType<DatabaseService['getClient']>>;

export const TABLE = 'access_changes';
/** the most recent ones shown for a product */
export const MAX_LISTED = 50;

/** `refused`: someone tried a change they may not make (shown in Control and evidence, not with the changes of a product). */
export type AccessChange = { at: string; actor: string; action: 'add' | 'remove' | 'refused'; username: string; group: string; component: string };

export async function ensureTable(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(TABLE)) return;
  await knex.schema.createTable(TABLE, t => {
    t.increments('id').primary();
    t.timestamp('at', { useTz: true }).notNullable();
    t.string('actor', 255).notNullable();
    t.string('action', 8).notNullable();
    t.string('username', 255).notNullable();
    t.string('group_name', 255).notNullable();
    t.string('component', 255).notNullable();
    t.index(['component', 'at'], 'access_changes_component_idx');
    t.index(['username', 'at'], 'access_changes_username_idx');
  });
}

const iso = (v: unknown) => (v instanceof Date ? v : new Date(v as string | number)).toISOString();
const changeOf = (r: Record<string, string>): AccessChange => ({ at: iso(r.at), actor: r.actor, action: r.action as AccessChange['action'], username: r.username, group: r.group_name, component: r.component });

export class AccessStore {
  constructor(private readonly knex: Knex) {}

  async record(change: Omit<AccessChange, 'at'>, now = new Date()): Promise<void> {
    await this.knex(TABLE).insert({ at: now, actor: change.actor, action: change.action, username: change.username, group_name: change.group, component: change.component });
  }

  /** the last changes of a product, the most recent first */
  async list(component: string, limit = MAX_LISTED): Promise<AccessChange[]> {
    const rows = await this.knex(TABLE).where({ component }).whereIn('action', ['add', 'remove']).orderBy('at', 'desc').orderBy('id', 'desc').limit(limit);
    return rows.map(changeOf);
  }

  /** the last changes and refused attempts of every product, the most recent first */
  async recent(limit = 500): Promise<AccessChange[]> {
    return (await this.knex(TABLE).orderBy('at', 'desc').orderBy('id', 'desc').limit(limit)).map(changeOf);
  }

  /** who was added to each group since a moment, and is not known to have been removed after */
  async addedSince(since: Date): Promise<Record<string, string[]>> {
    const rows = await this.knex(TABLE).where('at', '>=', since).whereIn('action', ['add', 'remove']).orderBy('at', 'asc').orderBy('id', 'asc');
    const added: Record<string, Set<string>> = {};
    for (const r of rows.map(changeOf)) {
      const set = (added[r.group] ??= new Set());
      if (r.action === 'add') set.add(r.username);
      else set.delete(r.username);
    }
    return Object.fromEntries(Object.entries(added).map(([g, s]) => [g, [...s]]));
  }
}
