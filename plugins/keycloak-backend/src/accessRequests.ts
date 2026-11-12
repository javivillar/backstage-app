import type { DatabaseService } from '@backstage/backend-plugin-api';

/**
 * The requests of access to a product (console › Portal › Manage › Access requests): a person asks to be put in a
 * group of a product, with a reason, and an administrator of that product approves it (the person is added to the
 * group, as in Access administration) or rejects it with a reason. Kept in the database of this plugin; a request is
 * never deleted, only decided or withdrawn.
 *
 * The table is created at start if missing; a change of its shape needs a migration.
 */
type Knex = Awaited<ReturnType<DatabaseService['getClient']>>;

export const REQUESTS_TABLE = 'access_requests';
export const MAX_REASON = 500;
/** the decided ones shown to who decides, and the ones a person sees of their own */
export const MAX_LISTED = 50;

export type RequestState = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export type AccessRequest = {
  id: number;
  at: string;
  /** the username of who asks */
  requester: string;
  group: string;
  component: string;
  reason: string;
  state: RequestState;
  /** the entity ref of who decided it */
  decidedBy?: string;
  decidedAt?: string;
  /** why it was rejected */
  answer?: string;
};

/** The reason of a request or of a rejection, trimmed; undefined when it is missing or too long. */
export function reasonOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const reason = value.trim();
  return reason && reason.length <= MAX_REASON ? reason : undefined;
}

export async function ensureRequestsTable(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(REQUESTS_TABLE)) return;
  await knex.schema.createTable(REQUESTS_TABLE, t => {
    t.increments('id').primary();
    t.timestamp('at', { useTz: true }).notNullable();
    t.string('requester', 255).notNullable();
    t.string('group_name', 255).notNullable();
    t.string('component', 255).notNullable();
    t.string('reason', MAX_REASON).notNullable();
    t.string('state', 16).notNullable();
    t.string('decided_by', 255);
    t.timestamp('decided_at', { useTz: true });
    t.string('answer', MAX_REASON);
    t.index(['component', 'state'], 'access_requests_component_idx');
    t.index(['requester', 'at'], 'access_requests_requester_idx');
  });
}

const iso = (v: unknown) =>
  (v instanceof Date ? v : new Date(v as string | number)).toISOString();

const row = (r: Record<string, unknown>): AccessRequest => ({
  id: Number(r.id),
  at: iso(r.at),
  requester: String(r.requester),
  group: String(r.group_name),
  component: String(r.component),
  reason: String(r.reason),
  state: r.state as RequestState,
  decidedBy: r.decided_by ? String(r.decided_by) : undefined,
  decidedAt: r.decided_at ? iso(r.decided_at) : undefined,
  answer: r.answer ? String(r.answer) : undefined,
});

export class AccessRequestStore {
  constructor(private readonly knex: Knex) {}

  async file(
    request: Pick<
      AccessRequest,
      'requester' | 'group' | 'component' | 'reason'
    >,
    now = new Date(),
  ): Promise<AccessRequest> {
    const [inserted] = await this.knex(REQUESTS_TABLE)
      .insert({
        at: now,
        requester: request.requester,
        group_name: request.group,
        component: request.component,
        reason: request.reason,
        state: 'pending',
      })
      .returning('id');
    const id =
      typeof inserted === 'object'
        ? Number((inserted as { id: number }).id)
        : Number(inserted);
    return { id, at: now.toISOString(), ...request, state: 'pending' };
  }

  async get(id: number): Promise<AccessRequest | undefined> {
    const found = await this.knex(REQUESTS_TABLE).where({ id }).first();
    return found ? row(found) : undefined;
  }

  /** the request of this person for this group that waits for a decision, if any */
  async pendingOf(
    requester: string,
    group: string,
  ): Promise<AccessRequest | undefined> {
    const found = await this.knex(REQUESTS_TABLE)
      .where({ requester, group_name: group, state: 'pending' })
      .first();
    return found ? row(found) : undefined;
  }

  /** the requests of a person, the most recent first */
  async of(requester: string, limit = MAX_LISTED): Promise<AccessRequest[]> {
    return (
      await this.knex(REQUESTS_TABLE)
        .where({ requester })
        .orderBy('at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit)
    ).map(row);
  }

  /** the requests of these products: every pending one (the oldest first), then the last decided */
  async forProducts(
    components: string[],
    limit = MAX_LISTED,
  ): Promise<{ pending: AccessRequest[]; decided: AccessRequest[] }> {
    if (!components.length) return { pending: [], decided: [] };
    const pending = await this.knex(REQUESTS_TABLE)
      .whereIn('component', components)
      .where({ state: 'pending' })
      .orderBy('at', 'asc')
      .orderBy('id', 'asc');
    const decided = await this.knex(REQUESTS_TABLE)
      .whereIn('component', components)
      .whereNot({ state: 'pending' })
      .orderBy('decided_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit);
    return { pending: pending.map(row), decided: decided.map(row) };
  }

  /** Decides a pending request; false when it was not pending any more (somebody else decided it). */
  async decide(
    id: number,
    state: Exclude<RequestState, 'pending'>,
    by: string,
    answer?: string,
    now = new Date(),
  ): Promise<boolean> {
    const changed = await this.knex(REQUESTS_TABLE)
      .where({ id, state: 'pending' })
      .update({
        state,
        decided_by: by,
        decided_at: now,
        answer: answer ?? null,
      });
    return changed > 0;
  }
}
