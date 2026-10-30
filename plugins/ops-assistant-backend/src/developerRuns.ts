/**
 * What the runs of the developer workflow consumed (workflow `develop` of refresquito-specs, GitHub Actions): they do
 * not go through Backstage, so a task asks GitHub every 30 minutes for the runs completed in the last days, reads the
 * artifact `usage` of each one (developer/usage.py of refresquito-specs: only figures, never the conversation) and
 * records it once (src/usage.ts, source `github:<owner>/<repo>/runs/<id>`).
 *
 * Each run is charged to who asked for it in Backstage (input requested_by, filled in by the template), to the
 * application developed (`components`) and to its system (`system`); a run started by hand on GitHub, to
 * `github:<actor>`. One row per model Claude Code used; the time of the run goes on the model that wrote the most.
 * Assistant `developer`, runner `github-actions`.
 *
 * GitHub is read with the token of the integration github.com of Backstage (it starts the workflow already: Actions
 * read and write on refresquito-specs). Config `assistantUsage.developerWorkflow: {owner, repo, workflow}`; without it
 * nothing is read.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { subjectName, type UsageRow, type UsageStore } from './usage';

export type WorkflowSettings = { owner: string; repo: string; workflow: string; token: string; api?: string };

type Run = { id: number; updated_at: string; conclusion?: string | null; actor?: { login?: string } };

const USER = /^user:[a-z0-9._-]+\/[a-z0-9._@-]+$/i;
const DAY = 24 * 3600 * 1000;
/** how far back a sweep looks: GitHub keeps the artifact 30 days, the sweep runs every 30 minutes */
export const LOOKBACK_DAYS = 7;

const count = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? Math.round(x) : 0;
};

/** the rows of a run from its usage.json; [] when it used no model */
export function rowsOfRun(run: Run, usage: any): UsageRow[] {
  if (!usage || typeof usage !== 'object' || usage.version !== 1) return [];
  const models = Object.entries((usage.models ?? {}) as Record<string, any>)
    .map(([model, t]) => ({
      model: String(model).slice(0, 128),
      usage: { input: count(t?.input), output: count(t?.output), cacheRead: count(t?.cacheRead), cacheWrite: count(t?.cacheWrite) },
    }))
    .filter(m => m.usage.input + m.usage.output + m.usage.cacheRead + m.usage.cacheWrite > 0)
    .sort((a, b) => b.usage.output - a.usage.output);
  const requested = typeof usage.requestedBy === 'string' && USER.test(usage.requestedBy) ? usage.requestedBy.toLocaleLowerCase('en-US') : '';
  const actor = subjectName(run.actor?.login);
  const user = requested || `github:${actor ?? 'unknown'}`;
  const app = subjectName(usage.application);
  const at = new Date(run.updated_at);
  return models.map((m, i) => ({
    at: Number.isNaN(at.getTime()) ? new Date() : at,
    assistant: 'developer',
    user,
    runner: 'github-actions',
    model: m.model,
    system: subjectName(usage.system),
    subjects: { systems: [], namespaces: [], components: app ? [app] : [] },
    usage: m.usage,
    ms: i === 0 ? count(usage.durationMs) : 0,
    tools: i === 0 ? count(usage.turns) : 0,
  }));
}

export class DeveloperRuns {
  constructor(private readonly s: WorkflowSettings, private readonly fetchImpl: typeof fetch = fetch) {}

  private get api() {
    return (this.s.api ?? 'https://api.github.com').replace(/\/+$/, '');
  }

  private async get(path: string): Promise<any> {
    const res = await this.fetchImpl(`${this.api}${path}`, {
      headers: { Authorization: `Bearer ${this.s.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`GitHub ${path.split('?')[0]}: ${res.status} ${res.statusText}`);
    return res.json();
  }

  /** the runs completed since `since`, the most recent first (at most 100: the sweep is every 30 minutes) */
  async completed(since: Date): Promise<Run[]> {
    const { owner, repo, workflow } = this.s;
    const body = await this.get(
      `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?status=completed&per_page=100&created=${encodeURIComponent(`>=${since.toISOString().slice(0, 10)}`)}`,
    );
    return Array.isArray(body?.workflow_runs) ? body.workflow_runs : [];
  }

  /** the usage.json of a run; undefined when it has no artifact usage (runs before it existed, or expired) */
  async usage(runId: number): Promise<any | undefined> {
    const { owner, repo } = this.s;
    const body = await this.get(`/repos/${owner}/${repo}/actions/runs/${runId}/artifacts?name=usage`);
    const artifact = (Array.isArray(body?.artifacts) ? body.artifacts : []).find((a: any) => a?.name === 'usage' && !a.expired);
    if (!artifact?.archive_download_url) return undefined;
    // GitHub answers with a redirect to its storage; fetch does not send the token there
    const res = await this.fetchImpl(artifact.archive_download_url, {
      headers: { Authorization: `Bearer ${this.s.token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`GitHub artifact of run ${runId}: ${res.status} ${res.statusText}`);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const file = files['usage.json'];
    if (!file) return undefined;
    try {
      return JSON.parse(strFromU8(file));
    } catch {
      return undefined;
    }
  }
}

export const sourceOf = (s: Pick<WorkflowSettings, 'owner' | 'repo'>, runId: number) => `github:${s.owner}/${s.repo}/runs/${runId}`;

/** one sweep: the runs not recorded yet; how many runs and rows were recorded */
export async function sweepDeveloperRuns(
  runs: DeveloperRuns,
  settings: Pick<WorkflowSettings, 'owner' | 'repo'>,
  store: UsageStore,
  now = new Date(),
): Promise<{ runs: number; rows: number }> {
  let recorded = 0;
  let rows = 0;
  for (const run of await runs.completed(new Date(now.getTime() - LOOKBACK_DAYS * DAY))) {
    const source = sourceOf(settings, run.id);
    if (await store.seen(source)) continue;
    const r = rowsOfRun(run, await runs.usage(run.id));
    // a run without usage is recorded as seen too: it is not asked again
    if (await store.recordSource(source, r, now)) {
      recorded += r.length ? 1 : 0;
      rows += r.length;
    }
  }
  return { runs: recorded, rows };
}
