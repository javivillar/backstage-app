import { mockServices, TestDatabases } from '@backstage/backend-test-utils';
import { ConfigReader } from '@backstage/config';
import express from 'express';
import request from 'supertest';
import { createAssistantRouter } from './assistant';
import { ConversationStore, ensureTable } from './conversations';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const state = (q: string) => ({ exchanges: [{ question: q, answer: 'a' }], messages: [{ role: 'user', parts: [] }] });

const databases = TestDatabases.create({ ids: ['SQLITE_3'] });

async function store() {
  const knex = await databases.init('SQLITE_3');
  await ensureTable(knex);
  await ensureTable(knex); // twice: the second start finds it
  return new ConversationStore(knex);
}

describe('ConversationStore', () => {
  it('keeps each user apart and lists the most recent first', async () => {
    const s = await store();
    await s.put('user:default/ana', 'functional', A, 'first', state('1'), new Date('2026-10-01T10:00:00Z'));
    await s.put('user:default/ana', 'functional', B, 'second', state('2'), new Date('2026-10-02T10:00:00Z'));
    expect((await s.list('user:default/ana', 'functional')).map(c => c.title)).toEqual(['second', 'first']);
    expect(await s.list('user:default/ana', 'sec')).toEqual([]);
    expect(await s.list('user:default/luis', 'functional')).toEqual([]);
    expect((await s.get('user:default/ana', 'functional', A))?.state).toEqual(state('1'));
    expect(await s.get('user:default/luis', 'functional', A)).toBeUndefined();
  });

  it('never overwrites or deletes the conversation of someone else', async () => {
    const s = await store();
    expect(await s.put('user:default/ana', 'functional', A, 'mine', state('1'))).toBe(true);
    expect(await s.put('user:default/luis', 'functional', A, 'stolen', state('x'))).toBe(false);
    expect(await s.put('user:default/ana', 'sec', A, 'other assistant', state('x'))).toBe(false);
    expect(await s.delete('user:default/luis', 'functional', A)).toBe(false);
    expect((await s.get('user:default/ana', 'functional', A))?.title).toBe('mine');
    expect(await s.put('user:default/ana', 'functional', A, 'renamed', state('2'))).toBe(true);
    expect((await s.get('user:default/ana', 'functional', A))?.state).toEqual(state('2'));
    expect(await s.delete('user:default/ana', 'functional', A)).toBe(true);
    expect(await s.get('user:default/ana', 'functional', A)).toBeUndefined();
  });

  it('deletes what was not changed in the retention days', async () => {
    const s = await store();
    await s.put('user:default/ana', 'functional', A, 'old', state('1'), new Date('2026-07-01T00:00:00Z'));
    await s.put('user:default/ana', 'functional', B, 'recent', state('2'), new Date('2026-10-20T00:00:00Z'));
    expect(await s.purge(90, new Date('2026-10-29T00:00:00Z'))).toBe(1);
    expect((await s.list('user:default/ana', 'functional')).map(c => c.title)).toEqual(['recent']);
  });
});

describe('the conversation routes', () => {
  function app(user: string, groups: string[], conversations?: ConversationStore) {
    const a = express();
    a.use(
      '/functional',
      createAssistantRouter({
        id: 'functional',
        settings: new ConfigReader({ allowedGroups: ['analysts'] }),
        httpAuth: mockServices.httpAuth({
          defaultCredentials: { $$type: '@backstage/BackstageCredentials', principal: { type: 'user', userEntityRef: user } } as any,
        }),
        userInfo: { getUserInfo: async () => ({ userEntityRef: user, ownershipEntityRefs: [user, ...groups] }) } as any,
        logger: mockServices.logger.mock(),
        conversations,
      }),
    );
    return a;
  }

  it('saves, lists, opens and deletes the conversations of the user', async () => {
    const s = await store();
    const ana = app('user:default/ana', ['group:default/analysts'], s);
    expect((await request(ana).put(`/functional/conversations/${A}`).send({ title: 'Animal shelter', state: state('q') })).status).toBe(204);
    const list = await request(ana).get('/functional/conversations');
    expect(list.body).toEqual([expect.objectContaining({ id: A, title: 'Animal shelter' })]);
    expect((await request(ana).get(`/functional/conversations/${A}`)).body.state).toEqual(state('q'));
    expect((await request(ana).delete(`/functional/conversations/${A}`)).status).toBe(204);
    expect((await request(ana).get(`/functional/conversations/${A}`)).status).toBe(404);
  });

  it('does not show or let change the conversation of another user', async () => {
    const s = await store();
    const ana = app('user:default/ana', ['group:default/analysts'], s);
    const luis = app('user:default/luis', ['group:default/analysts'], s);
    await request(ana).put(`/functional/conversations/${A}`).send({ title: 'mine', state: state('q') });
    expect((await request(luis).get('/functional/conversations')).body).toEqual([]);
    expect((await request(luis).get(`/functional/conversations/${A}`)).status).toBe(404);
    expect((await request(luis).put(`/functional/conversations/${A}`).send({ title: 'x', state: state('x') })).status).toBe(404);
    expect((await request(luis).delete(`/functional/conversations/${A}`)).status).toBe(404);
    expect((await request(ana).get(`/functional/conversations/${A}`)).body.title).toBe('mine');
  });

  it('refuses users outside its groups, bad ids and bad bodies, and answers 503 without a store', async () => {
    const s = await store();
    expect((await request(app('user:default/eve', [], s)).get('/functional/conversations')).status).toBe(403);
    const ana = app('user:default/ana', ['group:default/analysts'], s);
    expect((await request(ana).get('/functional/conversations/not-an-id')).status).toBe(400);
    expect((await request(ana).put(`/functional/conversations/${A}`).send({ title: 'x' })).status).toBe(400);
    expect((await request(app('user:default/ana', ['group:default/analysts'])).get('/functional/conversations')).status).toBe(503);
  });
});
