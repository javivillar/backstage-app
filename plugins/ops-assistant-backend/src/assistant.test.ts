import { mockServices } from '@backstage/backend-test-utils';
import { ConfigReader } from '@backstage/config';
import express from 'express';
import request from 'supertest';
import { createAssistantRouter } from './assistant';

/** a signed-in user of the given groups */
function deps(groups: string[]) {
  return {
    httpAuth: mockServices.httpAuth({ defaultCredentials: { $$type: '@backstage/BackstageCredentials', principal: { type: 'user', userEntityRef: 'user:default/ana' } } as any }),
    userInfo: { getUserInfo: async () => ({ userEntityRef: 'user:default/ana', ownershipEntityRefs: ['user:default/ana', ...groups] }) } as any,
    logger: mockServices.logger.mock(),
  };
}

const block = (o: Record<string, unknown>) => new ConfigReader(o);

describe('createAssistantRouter', () => {
  it('describes each assistant with its own title and groups', async () => {
    const app = express();
    const d = deps(['group:default/security-team']);
    app.use('/ops', createAssistantRouter({ id: 'ops', settings: block({ allowedGroups: ['backstage-admin'] }), ...d }));
    app.use('/sec', createAssistantRouter({ id: 'sec', settings: block({ title: 'Security assistant', allowedGroups: ['security-team'] }), ...d }));
    const ops = await request(app).get('/ops/info');
    const sec = await request(app).get('/sec/info');
    expect(ops.body).toMatchObject({ title: 'Operations assistant', allowed: false, enabled: false });
    expect(sec.body).toMatchObject({ title: 'Security assistant', allowed: true, enabled: false, runner: 'api' });
  });

  it('refuses whoever is not in its groups, and answers 503 while it is not configured', async () => {
    const app = express();
    app.use('/sec', createAssistantRouter({ id: 'sec', settings: block({ title: 'Security assistant', allowedGroups: ['security-team'] }), ...deps([]) }));
    const refused = await request(app).post('/sec/chat').send({ question: 'petstore?' });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toContain('security assistant');
    const app2 = express();
    app2.use('/sec', createAssistantRouter({ id: 'sec', settings: block({ allowedGroups: ['security-team'] }), ...deps(['group:default/security-team']) }));
    expect((await request(app2).post('/sec/chat').send({ question: 'petstore?' })).status).toBe(503);
  });

  it('is off without its block', async () => {
    const app = express();
    app.use('/x', createAssistantRouter({ id: 'x', ...deps([]) }));
    expect((await request(app).get('/x/info')).body).toMatchObject({ enabled: false, allowed: false, title: 'Assistant x' });
  });
});
