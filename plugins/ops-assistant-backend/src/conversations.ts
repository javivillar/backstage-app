/**
 * The conversations of the assistants, kept in the database of Backstage (coreServices.database: the database of this
 * plugin, Postgres in the platform, so they are in its backups) so that closing the tab, the browser or the session
 * does not lose them, and they can be opened again from any computer.
 *
 * One row per conversation: whose it is, of which assistant, its title (the first question) and what the page shows
 * and sends back to the model (`state`: the exchanges and the messages, JSON, opaque here). A user only ever sees,
 * changes or deletes their own. Kept `retentionDays` (default 90) after its last change, then deleted by a daily task.
 *
 * The table is created at start if missing (as seaweedfs-backend does); a change of its shape needs a migration.
 */
import type { Knex } from 'knex';

export const TABLE = 'assistant_conversations';
export const DEFAULT_RETENTION_DAYS = 90;
/** the most recent ones listed in the page */
export const MAX_LISTED = 100;
const MAX_TITLE = 200;
/** made by the page (crypto.randomUUID) */
export const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ConversationSummary = { id: string; title: string; updatedAt: string };
export type Conversation = ConversationSummary & { state: unknown };

export async function ensureTable(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(TABLE)) return;
  await knex.schema.createTable(TABLE, t => {
    t.string('id', 36).primary();
    t.string('user_ref', 255).notNullable();
    t.string('assistant', 16).notNullable();
    t.string('title', MAX_TITLE).notNullable();
    t.text('state').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable();
    t.timestamp('updated_at', { useTz: true }).notNullable();
    t.index(['user_ref', 'assistant', 'updated_at'], 'assistant_conversations_owner_idx');
  });
}

const iso = (v: unknown) => (v instanceof Date ? v : new Date(v as string | number)).toISOString();

export class ConversationStore {
  constructor(private readonly knex: Knex) {}

  /** the user's conversations with this assistant, the most recent first */
  async list(user: string, assistant: string): Promise<ConversationSummary[]> {
    const rows = await this.knex(TABLE)
      .select('id', 'title', 'updated_at')
      .where({ user_ref: user, assistant })
      .orderBy('updated_at', 'desc')
      .limit(MAX_LISTED);
    return rows.map(r => ({ id: r.id, title: r.title, updatedAt: iso(r.updated_at) }));
  }

  async get(user: string, assistant: string, id: string): Promise<Conversation | undefined> {
    const r = await this.knex(TABLE).where({ id, user_ref: user, assistant }).first();
    if (!r) return undefined;
    return { id: r.id, title: r.title, updatedAt: iso(r.updated_at), state: JSON.parse(r.state) };
  }

  /**
   * creates or replaces the user's conversation; false when the id is already someone else's (or another
   * assistant's), which is never overwritten
   */
  async put(user: string, assistant: string, id: string, title: string, state: unknown, now = new Date()): Promise<boolean> {
    const row = { title: title.slice(0, MAX_TITLE), state: JSON.stringify(state), updated_at: now };
    return this.knex.transaction(async tx => {
      const existing = await tx(TABLE).select('user_ref', 'assistant').where({ id }).first();
      if (existing) {
        if (existing.user_ref !== user || existing.assistant !== assistant) return false;
        await tx(TABLE).where({ id }).update(row);
      } else {
        await tx(TABLE).insert({ id, user_ref: user, assistant, created_at: now, ...row });
      }
      return true;
    });
  }

  async delete(user: string, assistant: string, id: string): Promise<boolean> {
    return (await this.knex(TABLE).where({ id, user_ref: user, assistant }).delete()) > 0;
  }

  /** deletes every conversation not changed in `days`; how many */
  async purge(days: number, now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - days * 24 * 3600 * 1000);
    return this.knex(TABLE).where('updated_at', '<', before).delete();
  }
}
