import { ArgoClient, mayAct } from './clusterActions';

describe('clusterActions', () => {
  it('lets act only the allowed groups', () => {
    expect(mayAct(['user:default/ana', 'group:default/backstage-admin'], ['backstage-admin'])).toBe(true);
    expect(mayAct(['user:default/ana', 'group:default/Backstage-Admin'], ['group:default/backstage-admin'])).toBe(true);
    expect(mayAct(['user:default/ana', 'group:default/team-pets'], ['backstage-admin'])).toBe(false);
  });

  it('logs in once and calls the Argo CD API', async () => {
    const calls: Array<{ url: string; body: unknown; auth?: string }> = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: (init?.headers as Record<string, string>)?.Authorization });
      if (url.endsWith('/api/v1/session')) return new Response(JSON.stringify({ token: 't0k' }), { status: 200 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const argo = new ArgoClient({ url: 'http://argo', username: 'admin', password: 'pw' }, fake);
    await argo.sync('petstore-oneke');
    await argo.restart('petstore-oneke', 'nato-sirtap-petstore-oneke', 'Deployment', 'petstore-oneke-api');
    expect(calls.map(c => c.url)).toEqual([
      'http://argo/api/v1/session',
      'http://argo/api/v1/applications/petstore-oneke/sync',
      'http://argo/api/v1/applications/petstore-oneke/resource/actions/v2',
    ]);
    expect(calls[1]).toMatchObject({ body: { prune: false }, auth: 'Bearer t0k' });
    expect(calls[2].body).toEqual({ namespace: 'nato-sirtap-petstore-oneke', resourceName: 'petstore-oneke-api', version: 'v1', kind: 'Deployment', group: 'apps', action: 'restart' });
  });

  it('says what Argo CD answered when it refuses', async () => {
    const fake = (async () => new Response(JSON.stringify({ message: 'permission denied' }), { status: 403 })) as unknown as typeof fetch;
    await expect(new ArgoClient({ url: 'http://argo', token: 'x' }, fake).sync('a')).rejects.toThrow('Argo CD answered 403: permission denied');
  });
});
