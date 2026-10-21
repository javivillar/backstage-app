import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { Request, Response, Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The live topology of the platform (page Topology): the HTML that the OpenNebula host generates and publishes in
 * every cluster (`configuration.py topology-publish`, a timer) as the ConfigMap refresquito-topology, mounted in
 * this pod (cnoe-oneke `backstage.topology`). Read only, for signed-in users.
 *
 *   GET /api/topology/status               {available, updated}: whether the host has published it, and when
 *   GET /api/topology/cookie               a session cookie for the frame below (the page asks for it first)
 *   GET /api/topology/frame/topology       the deployed state (topology.html), for the frame of the page
 *   GET /api/topology/frame/network        the design it is compared with (network.html)
 *
 * The frame loads its page by URL, with a Content-Security-Policy of its own: a page given inline (srcdoc) inherits
 * the policy of Backstage, which refuses inline scripts, and these pages draw everything with theirs. The policy
 * also sandboxes it (no same-origin): it cannot read Backstage or its token, even opened by itself.
 *
 * Config: topology.dir (default /topology), the directory of the mounted ConfigMap.
 */
const PAGES: Record<string, string> = { topology: 'topology.html', network: 'network.html' };

const FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com data:',
  'img-src data: blob:',
  "frame-ancestors 'self'",
  'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox',
].join('; ');

/**
 * Inside the frame, the page's link to the design (network.html) asks Backstage to switch tab: the frame is
 * sandboxed without same-origin, so it does not navigate to a sibling file.
 */
const BRIDGE = `<script>document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href="network.html"]');
  if (a) { e.preventDefault(); parent.postMessage({ rqTopology: 'network' }, '*'); }
});</script>`;

/** The page in the theme of Backstage (both pages carry their light and dark palettes, chosen by data-theme). */
export function prepare(html: string, theme: unknown): string {
  const mode = theme === 'dark' ? 'dark' : 'light';
  return html.replace(/<html([^>]*)>/i, `<html$1 data-theme="${mode}">`).replace(/<\/body>/i, `${BRIDGE}</body>`);
}

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

        // the frame is a navigation of the browser: no Backstage token, the cookie of /cookie instead
        const signedIn = async (req: Request, res: Response, cookie = false) => {
          try {
            await httpAuth.credentials(req, { allow: ['user'], allowLimitedAccess: cookie });
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
        router.get('/cookie', async (req, res) => {
          if (!(await signedIn(req, res))) return;
          const { expiresAt } = await httpAuth.issueUserCookie(res);
          res.json({ expiresAt: expiresAt.toISOString() });
        });
        router.get('/frame/:name', async (req, res) => {
          if (!(await signedIn(req, res, true))) return;
          if (!PAGES[req.params.name]) {
            res.status(404).json({ error: `No page ${req.params.name}` });
            return;
          }
          try {
            const html = await fs.promises.readFile(file(req.params.name), 'utf8');
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Content-Security-Policy', FRAME_CSP);
            res.type('text/html').send(prepare(html, req.query.theme));
          } catch {
            res.status(404).json({ error: 'The OpenNebula host has not published the topology to this cluster yet' });
          }
        });
        httpRouter.use(router);
        httpRouter.addAuthPolicy({ path: '/frame', allow: 'user-cookie' });
      },
    });
  },
});
