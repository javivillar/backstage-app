import { mockCredentials, mockServices, startTestBackend } from '@backstage/backend-test-utils';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import topology, { prepare } from './topology';

describe('topology', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topology-'));
    fs.writeFileSync(path.join(dir, 'topology.html'), '<!doctype html><html lang="en"><body><script>draw()</script></body></html>');
  });

  const start = () =>
    startTestBackend({
      features: [
        topology,
        mockServices.rootConfig.factory({ data: { topology: { dir } } }),
        // a request without a token or a cookie is nobody (the default of the mock is a signed-in user)
        mockServices.httpAuth.factory({ defaultCredentials: mockCredentials.none() }),
      ],
    });

  it('serves the frame with a policy of its own that lets its scripts run, sandboxed', async () => {
    const { server } = await start();
    const res = await request(server)
      .get('/api/topology/frame/topology?theme=dark')
      .set('Cookie', mockCredentials.limitedUser.cookie());
    expect(res.status).toBe(200);
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("script-src 'unsafe-inline'");
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
    expect(res.text).toContain('<html lang="en" data-theme="dark">');
    expect(res.text).toContain("parent.postMessage({ rqTopology: 'network' }");
  });

  it('refuses the frame without a session, and a page it does not have', async () => {
    const { server } = await start();
    expect((await request(server).get('/api/topology/frame/topology')).status).toBe(401);
    const res = await request(server).get('/api/topology/frame/secrets').set('Cookie', mockCredentials.limitedUser.cookie());
    expect(res.status).toBe(404);
  });

  it('gives the cookie only to a signed-in user', async () => {
    const { server } = await start();
    expect((await request(server).get('/api/topology/cookie')).status).toBe(401);
    const res = await request(server).get('/api/topology/cookie').set('Authorization', mockCredentials.user.header());
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).toBeDefined();
  });

  it('keeps the theme to light or dark', () => {
    expect(prepare('<html><body></body></html>', '"><script>')).toContain('data-theme="light"');
  });
});
