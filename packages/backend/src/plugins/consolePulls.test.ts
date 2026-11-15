import { askedBy, askerOf, mayCancel, openState, PullError, PullReader } from './consolePulls';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const pull = (number: number, ref: string, extra: Record<string, unknown> = {}) => ({
  number,
  title: `change ${number}`,
  html_url: `https://github.com/o/r/pull/${number}`,
  created_at: '2026-11-14T10:00:00Z',
  state: 'open',
  body: 'Prices of the platform changed from the console (FinOps › Prices) by user:default/ana.',
  head: { ref, sha: `sha${number}` },
  ...extra,
});

describe('pending changes of the console', () => {
  it('says where an open pull request stands', () => {
    expect(openState('dirty', [{ status: 'completed', conclusion: 'success' }])).toBe('conflict');
    expect(openState('blocked', [{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'failure' }])).toBe('failed');
    expect(openState('unstable', [{ status: 'in_progress' }, { status: 'completed', conclusion: 'success' }])).toBe('checking');
    expect(openState('clean', [{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'skipped' }])).toBe('ready');
    // no checks known: only the mergeable state speaks
    expect(openState('clean', undefined)).toBe('ready');
    expect(openState('blocked', [])).toBe('open');
    expect(openState(undefined, undefined)).toBe('open');
  });

  it('reads who asked for the change from the text of the pull request', () => {
    expect(askedBy('Prices changed from the console (FinOps › Prices) by user:default/ana.')).toBe('ana');
    expect(askedBy('Asked by User:acme/javi.villar from the console')).toBe('javi.villar');
    expect(askedBy('Opened by pull request')).toBeUndefined();
    expect(askedBy('No author here')).toBeUndefined();
    expect(askedBy(null)).toBeUndefined();
  });

  it('lists the pull requests of a kind with their state, and keeps the answer a minute', async () => {
    const calls: string[] = [];
    let now = NOW;
    const answers: Record<string, unknown> = {
      'pulls?state=all&base=main&sort=created&direction=desc&per_page=100': [
        pull(7, 'console/prices-0.2.123-a'),
        pull(6, 'console/protection-0.1.2-b'),
        pull(5, 'console/prices-0.2.122-c', { state: 'closed', merged_at: '2026-11-13T09:00:00Z', closed_at: '2026-11-13T09:00:00Z' }),
        pull(4, 'console/prices-0.2.121-d', { state: 'closed', closed_at: '2026-11-12T09:00:00Z' }),
        pull(3, 'console/prices-0.2.120-e', { state: 'closed', merged_at: '2026-10-01T09:00:00Z', closed_at: '2026-10-01T09:00:00Z' }),
        pull(2, 'feature/other'),
      ],
      'pulls/7': { mergeable_state: 'blocked' },
      'commits/sha7/check-runs?per_page=100': { check_runs: [{ status: 'in_progress' }] },
    };
    const fetchFn = (async (url: string) => {
      const path = String(url).replace('https://api.github.com/repos/o/r/', '');
      calls.push(path);
      return answers[path] !== undefined ? new Response(JSON.stringify(answers[path])) : new Response('{}', { status: 403 });
    }) as unknown as typeof fetch;
    const reader = new PullReader('o/r', 'main', 't', fetchFn, () => now);
    const pulls = await reader.list(['console/prices-']);
    expect(pulls.map(p => [p.number, p.state])).toEqual([[7, 'checking'], [5, 'merged'], [4, 'closed']]);
    expect(pulls[0]).toMatchObject({ title: 'change 7', url: 'https://github.com/o/r/pull/7', branch: 'console/prices-0.2.123-a', by: 'ana' });
    expect(pulls[1].closed).toBe('2026-11-13T09:00:00Z');
    expect(calls).toHaveLength(3);
    // within the minute nothing is asked again; after it, or once forgotten, it is
    await reader.list(['console/prices-']);
    expect(calls).toHaveLength(3);
    now += 61_000;
    await reader.list(['console/prices-']);
    expect(calls).toHaveLength(6);
    reader.forget();
    // the checks cannot be read (403): the pull request is still listed, as open
    answers['commits/sha7/check-runs?per_page=100'] = undefined;
    expect((await reader.list(['console/prices-']))[0].state).toBe('open');
  });

  it('lets who asked for a change, or who may make it, cancel it while it is open', () => {
    const ana = askerOf({ user: 'user:default/ana', may: false });
    expect(mayCancel({ state: 'checking', by: 'ana' }, ana)).toBe(true);
    expect(mayCancel({ state: 'ready', by: 'Ana' }, ana)).toBe(true);
    expect(mayCancel({ state: 'open', by: 'luis' }, ana)).toBe(false);
    expect(mayCancel({ state: 'open', by: undefined }, ana)).toBe(false);
    expect(mayCancel({ state: 'merged', by: 'ana' }, ana)).toBe(false);
    expect(mayCancel({ state: 'closed', by: 'ana' }, ana)).toBe(false);
    // who may make that kind of change cancels any of them; the plugins say it as may or as admin
    expect(mayCancel({ state: 'open', by: 'luis' }, askerOf({ user: 'user:default/eva', admin: true }))).toBe(true);
    expect(mayCancel({ state: 'failed', by: 'luis' }, askerOf({ user: 'user:default/eva', may: true }))).toBe(true);
    expect(askerOf(undefined)).toEqual({ user: undefined, may: false });
  });

  it('cancels a change: closes its pull request, says who did it and deletes the branch', async () => {
    const calls: Array<[string, string, unknown]> = [];
    const pulls: Record<string, unknown> = {
      'pulls/7': pull(7, 'console/prices-0.2.123-a'),
      'pulls/6': pull(6, 'console/protection-0.1.2-b'),
      'pulls/5': pull(5, 'console/prices-0.2.122-c', { state: 'closed', merged_at: '2026-11-13T09:00:00Z' }),
    };
    const fetchFn = (async (url: string, init?: RequestInit) => {
      const path = String(url).replace('https://api.github.com/repos/o/r/', '');
      const method = init?.method ?? 'GET';
      calls.push([method, path, init?.body ? JSON.parse(String(init.body)) : undefined]);
      if (method !== 'GET') return new Response('{}');
      return pulls[path] !== undefined ? new Response(JSON.stringify(pulls[path])) : new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const reader = new PullReader('o/r', 'main', 't', fetchFn, () => NOW);
    const yes = () => true;
    const done = await reader.cancel(7, ['console/prices-'], 'user:default/ana', yes);
    expect(done).toMatchObject({ number: 7, state: 'closed', by: 'ana', branch: 'console/prices-0.2.123-a' });
    expect(calls.slice(1)).toEqual([
      ['PATCH', 'pulls/7', { state: 'closed' }],
      ['POST', 'issues/7/comments', { body: 'Cancelled from the console by user:default/ana.' }],
      ['DELETE', 'git/refs/heads/console/prices-0.2.123-a', undefined],
    ]);
    // not of this kind, already accepted, not allowed, not there: nothing is closed
    const before = calls.length;
    await expect(reader.cancel(6, ['console/prices-'], 'x', yes)).rejects.toMatchObject({ status: 404 });
    await expect(reader.cancel(5, ['console/prices-'], 'x', yes)).rejects.toMatchObject({ status: 409 });
    await expect(reader.cancel(7, ['console/prices-'], 'x', () => false)).rejects.toMatchObject({ status: 403 });
    await expect(reader.cancel(99, ['console/prices-'], 'x', yes)).rejects.toBeInstanceOf(PullError);
    expect(calls.slice(before).every(c => c[0] === 'GET')).toBe(true);
  });

  it('fails when the repository cannot be listed', async () => {
    const reader = new PullReader('o/r', 'main', undefined, (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch);
    await expect(reader.list(['console/prices-'])).rejects.toThrow('could not be read');
  });
});
