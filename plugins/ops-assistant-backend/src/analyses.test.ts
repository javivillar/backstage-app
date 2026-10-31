import { mockCredentials, mockServices } from '@backstage/backend-test-utils';
import { ConfigReader } from '@backstage/config';
import express from 'express';
import request from 'supertest';
import { createAssistantRouter } from './assistant';

// a model that answers at once, and an MCP server with no tools: the analysis is the model's text
jest.mock('./model', () => ({
  providerFromConfig: () => ({
    label: 'fake model',
    complete: async () => ({ parts: [{ type: 'text', text: 'Priority looks right. Cause: the pod restarted.' }], stop: 'end', model: 'fake-1', usage: { input: 10, output: 5 } }),
  }),
}));
jest.mock('./mcp', () => ({
  McpClient: class {
    async listTools() {
      return [];
    }
    async callTool() {
      return { text: '', isError: false };
    }
  },
}));

const settings = new ConfigReader({
  title: 'Analysis assistant',
  mcpUrl: 'http://mcp',
  systemPrompt: 'Analyse.',
  allowedGroups: [],
  allowedApps: ['refresquito-apps-analysis'],
  maxRunningPerApp: 1,
  model: { provider: 'anthropic', apiKey: 'k' },
});

function app(credentials: unknown) {
  const usage = { record: jest.fn(async () => undefined) };
  const a = express();
  a.use(
    '/analysis',
    createAssistantRouter({
      id: 'analysis',
      settings,
      httpAuth: mockServices.httpAuth({ defaultCredentials: credentials as any }),
      userInfo: { getUserInfo: async () => ({ userEntityRef: 'user:default/ana', ownershipEntityRefs: ['group:default/backstage-admin'] }) } as any,
      logger: mockServices.logger.mock(),
      usage: usage as any,
    }),
  );
  return { a, usage };
}

const until = async (f: () => Promise<boolean>) => {
  for (let i = 0; i < 50; i++) {
    if (await f()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('timed out');
};

describe('analyses for the applications (block analysis)', () => {
  it('makes the analysis an allowed application asks for, and only it reads it', async () => {
    const { a, usage } = app(mockCredentials.service('external:refresquito-apps-analysis'));
    const started = await request(a).post('/analysis/analyses').send({ question: 'Incident: the API answers 500', system: 'support' });
    expect(started.status).toBe(202);
    let body: any;
    await until(async () => {
      body = (await request(a).get(`/analysis/analyses/${started.body.id}`)).body;
      return body.status !== 'running';
    });
    expect(body).toMatchObject({ status: 'done', answer: 'Priority looks right. Cause: the pod restarted.', model: 'fake-1' });
    expect(usage.record).toHaveBeenCalledWith(expect.objectContaining({ assistant: 'analysis', user: 'app:refresquito-apps-analysis', system: 'support' }));
    const other = app(mockCredentials.service('external:refresquito-apps-analysis'));
    expect((await request(other.a).get(`/analysis/analyses/${started.body.id}`)).status).toBe(404);
  });

  it('refuses a person, an application not allowed, and a bad question', async () => {
    expect((await request(app(mockCredentials.user('user:default/ana')).a).post('/analysis/analyses').send({ question: 'x' })).status).toBe(401);
    const refused = await request(app(mockCredentials.service('external:catalog-reader')).a).post('/analysis/analyses').send({ question: 'x' });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toContain('catalog-reader');
    const { a } = app(mockCredentials.service('external:refresquito-apps-analysis'));
    expect((await request(a).post('/analysis/analyses').send({ question: '' })).status).toBe(400);
    expect((await request(a).post('/analysis/analyses').send({ question: 'x', system: '???' })).status).toBe(400);
  });

  it('a person cannot read an analysis', async () => {
    const people = app(mockCredentials.user('user:default/ana'));
    expect((await request(people.a).get('/analysis/analyses/any')).status).toBe(401);
  });
});
