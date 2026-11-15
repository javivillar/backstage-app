import type express from 'express';

/**
 * The pull requests the console opens for a kind of change (prices, protection plans, organisations, process
 * models...), with where each one stands, so the page that opened them can show them until they are applied.
 *
 * A change of the console is a branch console/<kind>-... (GitHubFiles of clusterVms.ts); a kind is found by that
 * prefix. One request lists the pull requests of the repository; each open one costs two more (its mergeable state
 * and the checks of its last commit). The answer is kept a minute: the GitHub limit is shared by the whole portal.
 */
export type PullState =
  /** open, its checks are running */
  | 'checking'
  /** open, a check failed */
  | 'failed'
  /** open, it cannot be merged as it is (conflicts with the branch) */
  | 'conflict'
  /** open, checks passed: it can be merged */
  | 'ready'
  /** open, nothing is known of its checks */
  | 'open'
  | 'merged'
  /** closed without merging */
  | 'closed';
export type ChangePull = {
  number: number;
  title: string;
  url: string;
  branch: string;
  created: string;
  by?: string;
  state: PullState;
  closed?: string;
  /** whoever reads the list may cancel it (it is still open, and they asked for it or may make that kind of change) */
  cancel?: boolean;
};

/** Thrown for a cancel that cannot be done: the HTTP status says why. */
export class PullError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Who asks: its user (user:<namespace>/<name>) and whether it may make this kind of change. */
export type Asker = { user?: string; may: boolean };
/** Reads who asks from what the plugins already work out ({ user, may } or { user, admin }). */
export function askerOf(who: unknown): Asker {
  const w = (who ?? {}) as { user?: unknown; may?: unknown; admin?: unknown };
  return { user: typeof w.user === 'string' ? w.user : undefined, may: w.may === true || w.admin === true };
}
const nameOf = (user: string | undefined) => (user ?? '').split('/').pop()?.toLowerCase() ?? '';
/** A change still open may be cancelled by who asked for it, or by who may make that kind of change. */
export function mayCancel(pull: Pick<ChangePull, 'state' | 'by'>, asker: Asker): boolean {
  if (pull.state === 'merged' || pull.state === 'closed') return false;
  return asker.may || (!!pull.by && pull.by.toLowerCase() === nameOf(asker.user));
}

export type CheckRun = { status: string; conclusion?: string | null };
const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']);

/** Where an open pull request stands, from its mergeable state and the checks of its last commit (undefined: unknown). */
export function openState(mergeable: string | undefined, checks: CheckRun[] | undefined): PullState {
  if (mergeable === 'dirty') return 'conflict';
  if (checks?.length) {
    if (checks.some(c => FAILED.has(c.conclusion ?? ''))) return 'failed';
    if (checks.some(c => c.status !== 'completed')) return 'checking';
    return 'ready';
  }
  return mergeable === 'clean' ? 'ready' : 'open';
}

/** Who asked for the change: the console writes "by user:<namespace>/<name>" in the text of its pull requests. */
export function askedBy(body: string | null | undefined): string | undefined {
  const m = /\bby\s+user:[\w.-]+\/([\w.@-]+)/i.exec(body ?? '');
  return m ? m[1].replace(/\.$/, '') : undefined;
}

type Listed = { number: number; title: string; html_url: string; created_at: string; closed_at?: string | null; merged_at?: string | null; state: string; body?: string | null; head: { ref: string; sha: string } };

const TTL_MS = 60_000;

export class PullReader {
  private kept = new Map<string, { at: number; pulls: ChangePull[] }>();

  constructor(
    private readonly repo: string,
    private readonly branch: string,
    private readonly token: string | undefined,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private headers() {
    return { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) };
  }

  private send(method: string, path: string, body?: unknown) {
    return this.fetchFn(`https://api.github.com/repos/${this.repo}/${path}`, {
      method,
      headers: { ...this.headers(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  /**
   * Cancels a change: closes its pull request (with a comment that says who did it) and deletes its branch. Only an
   * open pull request whose branch starts with one of the prefixes; `allowed` decides from who asked for it.
   */
  async cancel(number: number, prefixes: string[], by: string, allowed: (pull: Pick<ChangePull, 'state' | 'by'>) => boolean): Promise<ChangePull> {
    const p = await this.get<Listed>(`pulls/${number}`);
    if (!p || !prefixes.some(x => p.head.ref.startsWith(x))) throw new PullError(`There is no such change #${number} here.`, 404);
    if (p.state !== 'open') throw new PullError(`#${number} is not open any more: it was ${p.merged_at ? 'accepted' : 'closed'}.`, 409);
    const asked = askedBy(p.body);
    if (!allowed({ state: 'open', by: asked })) throw new PullError('Only who asked for the change, or who may make it, can cancel it.', 403);
    const closed = await this.send('PATCH', `pulls/${number}`, { state: 'closed' });
    if (!closed.ok) throw new PullError(`GitHub answered ${closed.status} closing #${number} (does the token of Backstage have Pull requests: write?).`, 502);
    // the comment and the branch are a courtesy: the change is cancelled once the pull request is closed
    await this.send('POST', `issues/${number}/comments`, { body: `Cancelled from the console by ${by}.` }).catch(() => undefined);
    await this.send('DELETE', `git/refs/heads/${p.head.ref}`).catch(() => undefined);
    this.forget();
    return { number: p.number, title: p.title, url: p.html_url, branch: p.head.ref, created: p.created_at, by: asked, state: 'closed' };
  }

  private async get<T>(path: string): Promise<T | undefined> {
    const res = await this.fetchFn(`https://api.github.com/repos/${this.repo}/${path}`, { headers: this.headers() });
    return res.ok ? ((await res.json()) as T) : undefined;
  }

  /**
   * The pull requests whose branch starts with one of the prefixes: the open ones, and those merged or closed in the
   * last `days` days; newest first. Throws when the repository cannot be listed.
   */
  async list(prefixes: string[], days = 14): Promise<ChangePull[]> {
    const key = `${prefixes.join(' ')} ${days}`;
    const hit = this.kept.get(key);
    if (hit && this.now() - hit.at < TTL_MS) return hit.pulls;
    const all = await this.get<Listed[]>(`pulls?state=all&base=${encodeURIComponent(this.branch)}&sort=created&direction=desc&per_page=100`);
    if (!all) throw new Error(`The pull requests of ${this.repo} could not be read.`);
    const since = this.now() - days * 86_400_000;
    const mine = all.filter(p => prefixes.some(x => p.head.ref.startsWith(x)) && (p.state === 'open' || Date.parse(p.closed_at ?? '') >= since));
    const pulls = await Promise.all(
      mine.map(async (p): Promise<ChangePull> => {
        const base = { number: p.number, title: p.title, url: p.html_url, branch: p.head.ref, created: p.created_at, by: askedBy(p.body) };
        if (p.state !== 'open') return { ...base, state: p.merged_at ? 'merged' : 'closed', closed: p.merged_at ?? p.closed_at ?? undefined };
        // neither is needed to show the pull request: without them its state is just "open"
        const [one, checks] = await Promise.all([
          this.get<{ mergeable_state?: string }>(`pulls/${p.number}`).catch(() => undefined),
          this.get<{ check_runs?: CheckRun[] }>(`commits/${p.head.sha}/check-runs?per_page=100`).catch(() => undefined),
        ]);
        return { ...base, state: openState(one?.mergeable_state, checks?.check_runs) };
      }),
    );
    this.kept.set(key, { at: this.now(), pulls });
    return pulls;
  }

  /** Forget what is kept (after the console opens a pull request). */
  forget() {
    this.kept.clear();
  }
}

/**
 * GET handler: { pulls } of the prefixes `prefixesOf(req)` gives (undefined: 400); with ?fresh=1 nothing kept is used.
 * `who` throws for a request without a user; what it returns ({ user, may } or { user, admin }) says which pull
 * requests the reader may cancel.
 */
export function pullsHandler(reader: PullReader, prefixesOf: (req: express.Request) => string[] | undefined, who: (req: express.Request) => Promise<unknown>, warn: (message: string) => void) {
  return async (req: express.Request, res: express.Response) => {
    let asker: Asker;
    try {
      asker = askerOf(await who(req));
    } catch {
      res.status(401).json({ error: 'Sign in to read the pending changes' });
      return;
    }
    const prefixes = prefixesOf(req);
    if (!prefixes) {
      res.status(400).json({ error: 'Unknown kind of change.' });
      return;
    }
    try {
      // ?fresh=1 (the Refresh button of the card): read GitHub again, not what was kept
      if (req.query.fresh) reader.forget();
      res.json({ pulls: (await reader.list(prefixes)).map(p => ({ ...p, cancel: mayCancel(p, asker) })) });
    } catch (e) {
      warn((e as Error).message);
      res.status(502).json({ error: (e as Error).message });
    }
  };
}

/**
 * POST handler of <the list>/:number/cancel: closes that pull request and deletes its branch. Who may: who asked for
 * the change, or who may make that kind of change (`who`). Answers { pull } (closed).
 */
export function cancelHandler(reader: PullReader, prefixesOf: (req: express.Request) => string[] | undefined, who: (req: express.Request) => Promise<unknown>, log: (message: string) => void) {
  return async (req: express.Request, res: express.Response) => {
    let asker: Asker;
    try {
      asker = askerOf(await who(req));
    } catch {
      res.status(401).json({ error: 'Sign in to cancel a change' });
      return;
    }
    const prefixes = prefixesOf(req);
    const number = Number(req.params.number);
    if (!prefixes || !Number.isInteger(number) || number <= 0) {
      res.status(400).json({ error: 'Unknown change.' });
      return;
    }
    try {
      const pull = await reader.cancel(number, prefixes, asker.user ?? 'a user of the console', p => mayCancel(p, asker));
      log(`pull request #${number} cancelled by ${asker.user ?? '?'}`);
      res.json({ pull });
    } catch (e) {
      const status = e instanceof PullError ? e.status : 502;
      if (status === 502) log(`cancel #${number}: ${(e as Error).message}`);
      res.status(status).json({ error: (e as Error).message });
    }
  };
}
