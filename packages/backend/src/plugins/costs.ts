import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { Router } from 'express';
import { currentMonth, DeploymentStore, ensureTables, lookback, parseSweep, sweepQuery } from './costDeployments';

/**
 * The deployments of each namespace, charged in its cost (page /costs, Cost card): see costDeployments.ts.
 *
 *   GET /api/costs/deployments?month=YYYY-MM   {month, trackedSince, namespaces: {ns: {count, versions}}}
 *                                              (month: UTC, default the current one; signed-in users)
 *
 * Config: costs.prometheusUrl, the Prometheus that scrapes kube-state-metrics (observability-oneke). Without it, or
 * without the database, nothing is swept and the endpoint answers 503: the page shows the costs without deployments.
 */
export default createBackendPlugin({
  pluginId: 'costs',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        database: coreServices.database,
        scheduler: coreServices.scheduler,
      },
      async init({ httpRouter, httpAuth, config, logger, database, scheduler }) {
        const prometheus = config.getOptionalString('costs.prometheusUrl')?.replace(/\/+$/, '');
        let store: DeploymentStore | undefined;
        if (!prometheus) logger.info('costs: no costs.prometheusUrl, deployments are not counted');
        else {
          try {
            const knex = await database.getClient();
            await ensureTables(knex);
            store = new DeploymentStore(knex);
          } catch (e) {
            logger.error(`costs: deployments are not counted (database): ${(e as Error).message}`);
          }
        }

        if (store && prometheus) {
          const s = store;
          await scheduler.scheduleTask({
            id: 'costs-sweep-deployments',
            frequency: { minutes: 60 },
            timeout: { minutes: 5 },
            initialDelay: { minutes: 2 },
            fn: async () => {
              const now = new Date();
              const { seconds, step } = lookback(await s.lastSweep(), now);
              const url = `${prometheus}/api/v1/query?query=${encodeURIComponent(sweepQuery(seconds, step))}&time=${now.getTime() / 1000}`;
              const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
              if (!res.ok) throw new Error(`Prometheus answered ${res.status} ${res.statusText}`);
              const seen = parseSweep(await res.json());
              const added = await s.record(seen, now);
              logger.info(`costs: swept ${seen.length} images over ${Math.round(seconds / 60)} min, ${added} new deployments`);
            },
          });
        }

        const router = Router();
        router.get('/deployments', async (req, res) => {
          try {
            await httpAuth.credentials(req, { allow: ['user'] });
          } catch {
            res.status(401).json({ error: 'Sign in to read the costs' });
            return;
          }
          if (!store) {
            res.status(503).json({ error: 'Deployments are not counted (no costs.prometheusUrl or no database).' });
            return;
          }
          const month = typeof req.query.month === 'string' && req.query.month ? req.query.month : currentMonth();
          try {
            const body = await store.month(month);
            if (!body) res.status(400).json({ error: 'month is YYYY-MM' });
            else res.json(body);
          } catch (e) {
            logger.error(`costs: ${(e as Error).message}`);
            res.status(500).json({ error: 'The deployments could not be read' });
          }
        });
        httpRouter.use(router);
      },
    });
  },
});
