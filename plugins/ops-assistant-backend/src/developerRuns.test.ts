import { TestDatabases } from '@backstage/backend-test-utils';
import { strToU8, zipSync } from 'fflate';
import { DeveloperRuns, rowsOfRun, sweepDeveloperRuns } from './developerRuns';
import { ensureUsageTable, UsageStore } from './usage';

const databases = TestDatabases.create({ ids: ['SQLITE_3'] });

const usage = {
  version: 1,
  assistant: 'developer',
  requestedBy: 'user:default/Javi',
  system: 'animalshelter',
  change: 'add-adoptions',
  mode: 'implement',
  application: 'animalshelter',
  model: 'claude-opus-5-5',
  durationMs: 812345,
  turns: 87,
  models: {
    'claude-haiku-5-5': { input: 9000, output: 800, cacheRead: 0, cacheWrite: 0 },
    'claude-opus-5-5': { input: 120, output: 45000, cacheRead: 3000000, cacheWrite: 200000 },
  },
};

const run = (id: number, o: Record<string, unknown> = {}) => ({ id, updated_at: '2026-10-30T18:00:00Z', actor: { login: 'javivillar' }, ...o });

describe('rowsOfRun', () => {
  it('one row per model, charged to who asked, the application and its system; the time on the main model', () => {
    const rows = rowsOfRun(run(1), usage);
    expect(rows.map(r => [r.model, r.ms, r.tools])).toEqual([
      ['claude-opus-5-5', 812345, 87],
      ['claude-haiku-5-5', 0, 0],
    ]);
    expect(rows[0]).toMatchObject({
      assistant: 'developer',
      runner: 'github-actions',
      user: 'user:default/javi',
      system: 'animalshelter',
      subjects: { systems: [], namespaces: [], components: ['animalshelter'] },
      usage: { input: 120, output: 45000, cacheRead: 3000000, cacheWrite: 200000 },
    });
  });

  it('a run started by hand is charged to its GitHub actor; a run without models or another version, nothing', () => {
    expect(rowsOfRun(run(1), { ...usage, requestedBy: '' })[0].user).toBe('github:javivillar');
    expect(rowsOfRun(run(1), { ...usage, models: {} })).toEqual([]);
    expect(rowsOfRun(run(1), { ...usage, version: 2 })).toEqual([]);
    expect(rowsOfRun(run(1), undefined)).toEqual([]);
  });
});

describe('sweepDeveloperRuns', () => {
  /** a fake GitHub: run 10 with its artifact usage, run 11 without one (before it existed) */
  function github() {
    const calls: string[] = [];
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const impl = (async (url: string, init: any) => {
      calls.push(url);
      expect(init.headers.Authorization).toBe('Bearer T');
      if (url.includes('/actions/workflows/develop.yml/runs')) return json({ workflow_runs: [run(10), run(11)] });
      if (url.endsWith('/runs/10/artifacts?name=usage'))
        return json({ artifacts: [{ name: 'usage', expired: false, archive_download_url: 'https://api.github.com/zip/10' }] });
      if (url.endsWith('/runs/11/artifacts?name=usage')) return json({ artifacts: [] });
      if (url === 'https://api.github.com/zip/10') return new Response(zipSync({ 'usage.json': strToU8(JSON.stringify(usage)) }));
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    return { calls, impl };
  }

  it('records each run once, and does not ask again for the runs already seen', async () => {
    const knex = await databases.init('SQLITE_3');
    await ensureUsageTable(knex);
    const store = new UsageStore(knex);
    const gh = github();
    const settings = { owner: 'javivillar', repo: 'refresquito-specs', workflow: 'develop.yml', token: 'T' };
    const runs = new DeveloperRuns(settings, gh.impl);
    const now = new Date('2026-10-30T19:00:00Z');
    expect(await sweepDeveloperRuns(runs, settings, store, now)).toEqual({ runs: 1, rows: 2 });
    expect(gh.calls[0]).toContain('created=%3E%3D2026-10-23');
    const before = gh.calls.length;
    expect(await sweepDeveloperRuns(runs, settings, store, now)).toEqual({ runs: 0, rows: 0 });
    expect(gh.calls.length - before).toBe(1); // only the list: both runs were seen
    const month = (await store.month('2026-10', 'user:default/javi', false))!;
    expect(month.groups.map(g => [g.model, g.system, g.components, g.user, g.ms])).toEqual(
      expect.arrayContaining([
        ['claude-opus-5-5', 'animalshelter', ['animalshelter'], 'user:default/javi', 812345],
        ['claude-haiku-5-5', 'animalshelter', ['animalshelter'], 'user:default/javi', 0],
      ]),
    );
  });
});
