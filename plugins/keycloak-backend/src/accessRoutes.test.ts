import { mockServices, TestDatabases } from '@backstage/backend-test-utils';
import { ConfigReader } from '@backstage/config';
import express from 'express';
import request from 'supertest';
import { AccessRequestStore, ensureRequestsTable } from './accessRequests';
import { accessRouter } from './accessRoutes';
import { AccessStore, ensureTable } from './accessStore';

/**
 * A Keycloak in memory behind kcAdminFetch: Superset with its administrators (luis) and its users, and the group of
 * every bucket, which only the portal administrators change. ana and luis are local; hugo signs in through the hub.
 */
const tag = (component: string) => ({ 'refresquito.component': [component], 'refresquito.kind': ['role'] });
const GROUPS = [
  { id: 'g-admin', name: 'superset-admin', attributes: tag('superset-oneke') },
  { id: 'g-users', name: 'superset-users', attributes: tag('superset-oneke') },
  { id: 'g-s3', name: 's3-admins', attributes: tag('seaweedfs-oneke') },
];
let members: Record<string, Set<string>>;

jest.mock('./actions', () => ({
  ...jest.requireActual('./actions'),
  kcAdminFetch: async (_config: unknown, path: string, init: { method?: string } = {}) => {
    const answer = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
    const users = ['ana', 'luis', 'hugo'].map(u => ({ id: `u-${u}`, username: u, enabled: true }));
    if (path.startsWith('/groups?')) return answer(GROUPS);
    const of = /^\/groups\/([^/]+)\/members/.exec(path);
    if (of) return answer(users.filter(u => members[of[1]].has(u.username)));
    const named = /^\/users\?username=([^&]+)/.exec(path);
    if (named) return answer(users.filter(u => u.username === named[1]));
    const linked = /^\/users\/u-([^/]+)\/federated-identity$/.exec(path);
    if (linked) return answer(linked[1] === 'hugo' ? [{ identityProvider: 'hub' }] : []);
    const membership = /^\/users\/u-([^/]+)\/groups\/([^/]+)$/.exec(path);
    if (membership && init.method === 'PUT') {
      members[membership[2]].add(membership[1]);
      return answer({}, 204);
    }
    return answer({}, 404);
  },
}));

const databases = TestDatabases.create({ ids: ['SQLITE_3'] });
const REFS: Record<string, string[]> = {
  ana: [],
  hugo: [],
  luis: ['group:default/superset-admin'],
  rosa: ['group:default/backstage-admin'],
  eva: ['group:default/superset-users'],
};

async function app() {
  const knex = await databases.init('SQLITE_3');
  await ensureTable(knex);
  await ensureRequestsTable(knex);
  await ensureRequestsTable(knex); // twice: the second start finds it
  const api = express();
  api.use(
    express.json(),
    accessRouter({
      config: new ConfigReader({}),
      logger: mockServices.logger.mock(),
      catalog: { getEntities: async () => ({ items: [] }) } as never,
      store: new AccessStore(knex),
      requests: new AccessRequestStore(knex),
      caller: async req => {
        const user = String(req.headers['x-user']);
        return { credentials: {} as never, entityRef: `user:default/${user}`, ownershipEntityRefs: [`user:default/${user}`, ...REFS[user]] };
      },
    }),
  );
  return api;
}

const as = (api: express.Express, user: string) => ({
  get: (path: string) => request(api).get(path).set('x-user', user),
  post: (path: string, body?: object) => request(api).post(path).set('x-user', user).send(body),
  delete: (path: string) => request(api).delete(path).set('x-user', user),
});
const ask = (api: express.Express, user: string, group = 'superset-users', reason = 'I build the dashboards of SIRTAP') => as(api, user).post('/requests', { group, reason });

describe('requests of access to a product', () => {
  beforeEach(() => {
    members = { 'g-admin': new Set(['luis']), 'g-users': new Set(['eva']), 'g-s3': new Set() };
  });

  it('shows what a person may ask for: never a group only the portal administrators change', async () => {
    const api = await app();
    const body = (await as(api, 'eva').get('/requests')).body;
    expect(body.products.map((p: { component: string }) => p.component)).toEqual(['superset-oneke']);
    expect(body.products[0].groups).toEqual([
      expect.objectContaining({ name: 'superset-admin', admin: true, member: false, pending: false }),
      expect.objectContaining({ name: 'superset-users', admin: false, member: true, pending: false }),
    ]);
    expect(body.decides).toBe(false);
  });

  it('lets a person ask once, with a reason, for a group they are not in', async () => {
    const api = await app();
    expect((await ask(api, 'ana', 'superset-users', '  ')).status).toBe(400);
    expect((await ask(api, 'ana', 's3-admins')).status).toBe(404);
    expect((await ask(api, 'ana', 'nothing')).status).toBe(404);
    expect((await ask(api, 'eva')).status).toBe(409);
    const filed = await ask(api, 'ana');
    expect(filed.status).toBe(201);
    expect(filed.body).toMatchObject({ requester: 'ana', group: 'superset-users', component: 'superset-oneke', state: 'pending' });
    expect((await ask(api, 'ana')).status).toBe(409);
    const mine = (await as(api, 'ana').get('/requests')).body;
    expect(mine.mine).toHaveLength(1);
    expect(mine.products[0].groups[1]).toMatchObject({ name: 'superset-users', pending: true });
    expect(mine.pending).toEqual([]);
  });

  it('lets an administrator of the product approve it: the person is in the group and it is recorded', async () => {
    const api = await app();
    const { id } = (await ask(api, 'ana')).body;
    // nobody else decides it
    expect((await as(api, 'eva').post(`/requests/${id}/approval`)).status).toBe(403);
    expect((await as(api, 'ana').post(`/requests/${id}/approval`)).status).toBe(403);
    const waiting = (await as(api, 'luis').get('/requests')).body;
    expect(waiting.decides).toBe(true);
    expect(waiting.pending).toEqual([expect.objectContaining({ id, requester: 'ana', reason: 'I build the dashboards of SIRTAP' })]);
    expect((await as(api, 'luis').post(`/requests/${id}/approval`)).status).toBe(200);
    expect(members['g-users'].has('ana')).toBe(true);
    const after = (await as(api, 'luis').get('/requests')).body;
    expect(after.pending).toEqual([]);
    expect(after.decided).toEqual([expect.objectContaining({ id, state: 'approved', decidedBy: 'user:default/luis' })]);
    expect((await as(api, 'luis').get('/products/superset-oneke')).body.changes).toEqual([
      expect.objectContaining({ actor: 'user:default/luis', action: 'add', username: 'ana', group: 'superset-users' }),
    ]);
    // decided once
    expect((await as(api, 'rosa').post(`/requests/${id}/approval`)).status).toBe(409);
  });

  it('keeps the request waiting when the person cannot be added', async () => {
    const api = await app();
    const { id } = (await ask(api, 'hugo')).body;
    const refused = await as(api, 'luis').post(`/requests/${id}/approval`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain('signs in through hub');
    expect(members['g-users'].has('hugo')).toBe(false);
    expect((await as(api, 'luis').get('/requests')).body.pending).toHaveLength(1);
  });

  it('rejects with a reason the person reads', async () => {
    const api = await app();
    const { id } = (await ask(api, 'ana', 'superset-admin')).body;
    expect((await as(api, 'luis').post(`/requests/${id}/rejection`, {})).status).toBe(400);
    expect((await as(api, 'eva').post(`/requests/${id}/rejection`, { reason: 'no' })).status).toBe(403);
    expect((await as(api, 'rosa').post(`/requests/${id}/rejection`, { reason: 'Two administrators are enough' })).status).toBe(200);
    expect(members['g-admin'].has('ana')).toBe(false);
    expect((await as(api, 'ana').get('/requests')).body.mine).toEqual([
      expect.objectContaining({ id, state: 'rejected', answer: 'Two administrators are enough', decidedBy: 'user:default/rosa' }),
    ]);
    // and may ask again
    expect((await ask(api, 'ana', 'superset-admin')).status).toBe(201);
  });

  it('lets only who asked withdraw a request that waits', async () => {
    const api = await app();
    const { id } = (await ask(api, 'ana')).body;
    expect((await as(api, 'luis').delete(`/requests/${id}`)).status).toBe(403);
    expect((await as(api, 'ana').delete(`/requests/${id}`)).status).toBe(200);
    expect((await as(api, 'ana').delete(`/requests/${id}`)).status).toBe(409);
    expect((await as(api, 'luis').post(`/requests/${id}/approval`)).status).toBe(409);
    expect((await as(api, 'ana').delete('/requests/999')).status).toBe(404);
  });
});
