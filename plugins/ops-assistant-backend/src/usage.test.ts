import { mockServices, TestDatabases } from '@backstage/backend-test-utils';
import { ConfigReader } from '@backstage/config';
import express from 'express';
import request from 'supertest';
import { createAssistantRouter } from './assistant';
import { ensureUsageTable, monthRange, subjectName, subjectsOf, UsageStore, type UsageRow } from './usage';

const databases = TestDatabases.create({ ids: ['SQLITE_3'] });

async function store() {
  const knex = await databases.init('SQLITE_3');
  await ensureUsageTable(knex);
  await ensureUsageTable(knex); // twice: the second start finds it
  return new UsageStore(knex);
}

const row = (o: Partial<UsageRow> = {}): UsageRow => ({
  at: new Date('2026-10-15T10:00:00Z'),
  assistant: 'functional',
  user: 'user:default/ana',
  runner: 'api',
  model: 'claude-opus-5-5',
  subjects: { systems: ['petstore'], namespaces: [], components: [] },
  usage: { input: 1000, output: 200, cacheRead: 5000, cacheWrite: 300 },
  ms: 4000,
  tools: 2,
  ...o,
});

describe('what a question was about', () => {
  it('takes the systems, namespaces and projects the tools were asked about', () => {
    const call = (input: Record<string, unknown>) => ({ name: 't', input, isError: false, chars: 1 });
    expect(
      subjectsOf([
        call({ system: 'Petstore' }),
        call({ system: 'system:default/animalshelter' }),
        call({ namespace: 'nato-sirtap-petstore-oneke', kind: 'Pod' }),
        call({ project: 'petstore-oneke' }),
        call({ system: 'petstore' }),
        call({ system: 'not a name!' }),
        call({ namespace: 42 }),
      ]),
    ).toEqual({ systems: ['animalshelter', 'petstore'], namespaces: ['nato-sirtap-petstore-oneke'], components: ['petstore-oneke'] });
    expect(subjectsOf([])).toEqual({ systems: [], namespaces: [], components: [] });
  });

  it('names', () => {
    expect(subjectName('javivillar/Orders')).toBe('orders');
    expect(subjectName('')).toBeUndefined();
    expect(subjectName('a b')).toBeUndefined();
  });

  it('months', () => {
    expect(monthRange('2026-10')?.map(d => d.toISOString())).toEqual(['2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z']);
    expect(monthRange('2026-13')).toBeUndefined();
  });
});

describe('UsageStore', () => {
  it('groups the month and shows who asked only to themselves, or to everyone with all', async () => {
    const s = await store();
    await s.record(row());
    await s.record(row({ usage: { input: 10, output: 5 } }));
    await s.record(row({ user: 'user:default/luis', system: 'animalshelter', subjects: { systems: [], namespaces: [], components: [] } }));
    // a local server that does not say what it used
    await s.record(row({ user: 'user:default/luis', model: 'gpt-oss-20b', usage: {} }));
    await s.record(row({ at: new Date('2026-09-30T23:59:59Z') }));

    const ana = (await s.month('2026-10', 'user:default/ana', false))!;
    expect(ana.all).toBe(false);
    const mine = ana.groups.filter(g => g.user === 'user:default/ana');
    expect(mine).toEqual([
      expect.objectContaining({ assistant: 'functional', systems: ['petstore'], questions: 2, input: 1010, output: 205, cacheRead: 5000, unreported: 0, ms: 8000 }),
    ]);
    expect(ana.groups.filter(g => g.user === undefined).length).toBe(2);
    expect(ana.groups.find(g => g.system === 'animalshelter')?.user).toBeUndefined();
    expect(ana.groups.find(g => g.model === 'gpt-oss-20b')).toMatchObject({ input: 0, unreported: 1 });

    const admin = (await s.month('2026-10', 'user:default/admin', true))!;
    expect(admin.groups.map(g => g.user).sort()).toEqual(['user:default/ana', 'user:default/luis', 'user:default/luis']);
    expect((await s.month('2026-09', 'user:default/ana', false))!.groups).toHaveLength(1);
    expect(await s.month('october', 'user:default/ana', false)).toBeUndefined();
  });

  it('deletes what is older than the retention days', async () => {
    const s = await store();
    await s.record(row({ at: new Date('2025-01-01T00:00:00Z') }));
    await s.record(row());
    expect(await s.purge(400, new Date('2026-10-30T00:00:00Z'))).toBe(1);
  });
});

describe('a question to a local model (runner api, OpenAI-compatible server, no Claude Code)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  /** a fake llama.cpp/Ollama server that calls one tool and then answers, and a fake MCP server */
  function fakeServers(reportUsage: boolean) {
    let llmCalls = 0;
    global.fetch = (async (url: string, init: any) => {
      const body = JSON.parse(init.body);
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url === 'http://mcp/mcp') {
        if (body.method === 'initialize') return json({ jsonrpc: '2.0', id: body.id, result: {} });
        if (body.method === 'tools/list')
          return json({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'list_resources', description: 'list', inputSchema: { type: 'object' } }] } });
        return json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '3 pods' }] } });
      }
      llmCalls++;
      const usage = reportUsage ? { usage: { prompt_tokens: 700, completion_tokens: 40 } } : {};
      if (llmCalls === 1)
        return json({
          model: 'gpt-oss-20b',
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_resources', arguments: JSON.stringify({ kind: 'Pod', namespace: 'nato-sirtap-petstore-oneke' }) } }],
              },
            },
          ],
          ...usage,
        });
      return json({ model: 'gpt-oss-20b', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'All 3 pods run.' } }], ...usage });
    }) as unknown as typeof fetch;
  }

  function app(s: UsageStore) {
    const a = express();
    a.use(
      '/ops',
      createAssistantRouter({
        id: 'ops',
        settings: new ConfigReader({
          allowedGroups: ['backstage-admin'],
          mcpUrl: 'http://mcp/mcp',
          systemPrompt: 'be brief',
          runner: 'api',
          model: { provider: 'local', baseUrl: 'http://llm:8080', name: 'gpt-oss-20b' },
        }),
        httpAuth: mockServices.httpAuth({
          defaultCredentials: { $$type: '@backstage/BackstageCredentials', principal: { type: 'user', userEntityRef: 'user:default/ana' } } as any,
        }),
        userInfo: { getUserInfo: async () => ({ userEntityRef: 'user:default/ana', ownershipEntityRefs: ['group:default/backstage-admin'] }) } as any,
        logger: mockServices.logger.mock(),
        usage: s,
      }),
    );
    return a;
  }

  async function ask(a: express.Express, body: Record<string, unknown>) {
    const started = await request(a).post('/ops/chat').send(body);
    expect(started.status).toBe(202);
    for (let i = 0; i < 50; i++) {
      const job = await request(a).get(`/ops/chat/${started.body.id}`);
      if (job.body.status !== 'running') return job.body;
      await new Promise(r => setTimeout(r, 20));
    }
    throw new Error('the question did not end');
  }

  it('records its tokens, who asked, and the namespace the tools looked at', async () => {
    fakeServers(true);
    const s = await store();
    const done = await ask(app(s), { question: 'Is petstore up?' });
    expect(done.status).toBe('done');
    const month = (await s.month(new Date().toISOString().slice(0, 7), 'user:default/ana', false))!;
    expect(month.groups).toEqual([
      expect.objectContaining({
        assistant: 'ops',
        user: 'user:default/ana',
        runner: 'api',
        model: 'gpt-oss-20b',
        namespaces: ['nato-sirtap-petstore-oneke'],
        questions: 1,
        input: 1400,
        output: 80,
        unreported: 0,
      }),
    ]);
  });

  it('charges the system chosen in the page, and still answers when the server reports no tokens', async () => {
    fakeServers(false);
    const s = await store();
    const done = await ask(app(s), { question: 'Is it up?', system: 'Petstore' });
    expect(done.status).toBe('done');
    const [g] = (await s.month(new Date().toISOString().slice(0, 7), 'user:default/ana', false))!.groups;
    expect(g).toMatchObject({ system: 'petstore', input: 0, unreported: 1 });
    expect(g.ms).toBeGreaterThanOrEqual(0);
  });

  it('refuses a system that is not a name', async () => {
    fakeServers(true);
    const s = await store();
    expect((await request(app(s)).post('/ops/chat').send({ question: 'x', system: 'not a name!' })).status).toBe(400);
  });
});
