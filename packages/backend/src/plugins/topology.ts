import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { Request, Response, Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The live topology of the platform (page Topology): the HTML that the OpenNebula host generates and publishes in
 * every cluster (`configuration.py topology-publish`, a timer) as the ConfigMap refresquito-topology, mounted in
 * this pod (cnoe-oneke `backstage.topology`). Read only, for signed-in users.
 *
 *   GET /api/topology/status            {available, updated}: whether the host has published it, and when
 *   GET /api/topology/page/topology     the deployed state (topology.html)
 *   GET /api/topology/page/network      the design it is compared with (network.html)
 *
 * Config: topology.dir (default /topology), the directory of the mounted ConfigMap.
 */
const PAGES: Record<string, string> = { topology: 'topology.html', network: 'network.html' };

export default createBackendPlugin({
  pluginId: 'topology',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        config: coreServices.rootConfig,
      },
      async init({ httpRouter, httpAuth, config }) {
        const dir = config.getOptionalString('topology.dir') ?? '/topology';
        const file = (name: string) => path.join(dir, PAGES[name]);

        const signedIn = async (req: Request, res: Response) => {
          try {
            await httpAuth.credentials(req, { allow: ['user'] });
            return true;
          } catch {
            res.status(401).json({ error: 'Sign in to read the topology' });
            return false;
          }
        };

        const router = Router();
        router.get('/status', async (req, res) => {
          if (!(await signedIn(req, res))) return;
          try {
            // a ConfigMap volume swaps its files at once: the time of the page is when the host last published it
            const stat = await fs.promises.stat(file('topology'));
            res.json({ available: true, updated: stat.mtime.toISOString() });
          } catch {
            res.json({ available: false });
          }
        });
        router.get('/page/:name', async (req, res) => {
          if (!(await signedIn(req, res))) return;
          if (!PAGES[req.params.name]) {
            res.status(404).json({ error: `No page ${req.params.name}` });
            return;
          }
          try {
            const html = await fs.promises.readFile(file(req.params.name), 'utf8');
            res.setHeader('Cache-Control', 'no-store');
            res.type('text/html').send(html);
          } catch {
            res.status(404).json({ error: 'The OpenNebula host has not published the topology to this cluster yet' });
          }
        });
        httpRouter.use(router);
      },
    });
  },
});
