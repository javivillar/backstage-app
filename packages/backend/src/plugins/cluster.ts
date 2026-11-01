import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { Router } from 'express';
import { type ClusterOverview, prometheusQuery, readOverview } from './clusterOverview';

/**
 * The overview of this cluster for the console (page /console/cluster): nodes, Argo CD applications, volumes.
 *
 *   GET /api/cluster/overview   ClusterOverview (signed-in users; cached 30 s)
 *
 * Config: costs.prometheusUrl (the same Prometheus as the costs). Without it the endpoint answers 503.
 */
export default createBackendPlugin({
  pluginId: 'cluster',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ httpRouter, httpAuth, config, logger }) {
        const prometheus = config.getOptionalString('costs.prometheusUrl')?.replace(/\/+$/, '');
        const query = prometheus ? prometheusQuery(prometheus) : undefined;
        let cache: { at: number; body: ClusterOverview } | undefined;

        const router = Router();
        router.get('/overview', async (req, res) => {
          try {
            await httpAuth.credentials(req, { allow: ['user'] });
          } catch {
            res.status(401).json({ error: 'Sign in to read the cluster' });
            return;
          }
          if (!query) {
            res.status(503).json({ error: 'No Prometheus configured (costs.prometheusUrl).' });
            return;
          }
          try {
            if (!cache || Date.now() - cache.at > 30_000) cache = { at: Date.now(), body: await readOverview(query) };
            res.json(cache.body);
          } catch (e) {
            logger.error(`cluster: ${(e as Error).message}`);
            res.status(502).json({ error: `Prometheus did not answer: ${(e as Error).message}` });
          }
        });
        httpRouter.use(router);
      },
    });
  },
});
