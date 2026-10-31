/**
 * The questions being answered. A question takes from seconds to minutes (the model calls several tools), longer
 * than a proxy on the way (Traefik, HAProxy) keeps a request open: so POST /chat only starts the job and the page
 * asks for it (GET /chat/:id) every few seconds, seeing the tools called meanwhile.
 *
 * In memory: Backstage runs one replica, and a job lost to a restart is simply asked again.
 */
import { randomUUID } from 'node:crypto';
import { Cancelled, type ToolCallRecord, type Turn } from './agent';

export interface Job {
  id: string;
  user: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  /** aborted by cancel(): the work stops */
  signal: AbortSignal;
  startedAt: number;
  endedAt?: number;
  toolCalls: ToolCallRecord[];
  turn?: Turn;
  error?: string;
}

export const MAX_RUNNING_PER_USER = 2;
/** a finished job is kept this long for the page to collect it */
export const KEEP_MS = 30 * 60 * 1000;

export class Jobs {
  private readonly jobs = new Map<string, Job>();
  private readonly aborts = new Map<string, AbortController>();

  constructor(private readonly now: () => number = Date.now) {}

  private sweep() {
    const limit = this.now() - KEEP_MS;
    for (const [id, j] of this.jobs) if ((j.endedAt ?? j.startedAt + KEEP_MS) < limit) this.jobs.delete(id);
  }

  running(user: string): number {
    return [...this.jobs.values()].filter(j => j.user === user && j.status === 'running').length;
  }

  /** starts work(job) in the background; undefined when the user already has `limit` (MAX_RUNNING_PER_USER) running */
  start(user: string, work: (job: Job) => Promise<Turn>, limit = MAX_RUNNING_PER_USER): Job | undefined {
    this.sweep();
    if (this.running(user) >= limit) return undefined;
    const abort = new AbortController();
    const job: Job = { id: randomUUID(), user, status: 'running', startedAt: this.now(), toolCalls: [], signal: abort.signal };
    this.jobs.set(job.id, job);
    this.aborts.set(job.id, abort);
    work(job).then(
      turn => {
        if (job.status === 'running') Object.assign(job, { status: 'done', turn, endedAt: this.now() });
      },
      e => {
        if (job.status !== 'running') return;
        if (e instanceof Cancelled || abort.signal.aborted) Object.assign(job, { status: 'cancelled', endedAt: this.now() });
        else Object.assign(job, { status: 'error', error: (e as Error).message, endedAt: this.now() });
      },
    ).finally(() => this.aborts.delete(job.id));
    return job;
  }

  /** stops a running job of this user; false when there is no such job running */
  cancel(id: string, user: string): boolean {
    const job = this.get(id, user);
    if (!job || job.status !== 'running') return false;
    Object.assign(job, { status: 'cancelled', endedAt: this.now() });
    this.aborts.get(id)?.abort();
    return true;
  }

  /** only its own user sees a job */
  get(id: string, user: string): Job | undefined {
    const job = this.jobs.get(id);
    return job && job.user === user ? job : undefined;
  }
}
