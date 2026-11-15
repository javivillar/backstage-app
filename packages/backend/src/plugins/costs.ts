import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import express, { Router } from 'express';
import { mayAct } from './clusterActions';
import { GitHubFiles } from './clusterVms';
import { PullReader, pullsHandler } from './consolePulls';
import { PriceError, priceChange, pricePaths, readChanges, readPrices, type PriceFiles } from './costPrices';
import { currentMonth, DeploymentStore, ensureTables, lookback, parseSweep, sweepQuery } from './costDeployments';

/**
 * The deployments of each namespace, charged in its cost (page /costs, Cost card): see costDeployments.ts.
 *
 *   GET /api/costs/deployments?month=YYYY-MM   {month, trackedSince, namespaces: {ns: {count, versions}}}
 *                                              (month: UTC, default the current one; signed-in users)
 *
 *   GET  /api/costs/prices   {may, groups, repo, path, url, version, currency, description, prices}: the prices in the
 *                            repository (opencost.pricing of the chart, by path; see costPrices.ts). Signed-in users.
 *   GET  /api/costs/prices/pulls  → {pulls}: the pull requests of the prices, open or closed in the last 14 days,
 *                            with their state (consolePulls.ts)
 *   POST /api/costs/prices   {changes: {path: value}} → {pull, version}: a pull request with the prices changed, the
 *                            chart one patch version up and its release notes. Who may: backstage-admin,
 *                            console.actions.groups and costs.prices.groups (default finops).
 *
 * Config: costs.prices.repo / .branch / .chart (default console.manage.repo or javivillar/refresquito-services, main,
 * cnoe-oneke), the token of the GitHub integration. costs.prometheusUrl, the Prometheus that scrapes kube-state-metrics (observability-oneke). Without it, or
 * without the database, nothing is swept and the endpoint answers 503: the page shows the costs without deployments.
 */
export default createBackendPlugin({
  pluginId: 'costs',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        userInfo: coreServices.userInfo,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        database: coreServices.database,
        scheduler: coreServices.scheduler,
      },
      async init({ httpRouter, httpAuth, userInfo, config, logger, database, scheduler }) {
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

        // ---- the prices: read from the chart in the repository, changed with a pull request
        const prices = {
          repo: config.getOptionalString('costs.prices.repo') ?? config.getOptionalString('console.manage.repo') ?? 'javivillar/refresquito-services',
          branch: config.getOptionalString('costs.prices.branch') ?? 'main',
          chart: config.getOptionalString('costs.prices.chart') ?? 'cnoe-oneke',
          groups: [...new Set(['backstage-admin', ...(config.getOptionalStringArray('console.actions.groups') ?? []), ...(config.getOptionalStringArray('costs.prices.groups') ?? ['finops'])])],
        };
        const repo = new GitHubFiles(prices.repo, prices.branch, config.getOptionalConfigArray('integrations.github')?.[0]?.getOptionalString('token'));
        const paths = pricePaths(prices.chart);
        const pulls = new PullReader(prices.repo, prices.branch, config.getOptionalConfigArray('integrations.github')?.[0]?.getOptionalString('token'));
        const asks = async (req: express.Request) => {
          const credentials = await httpAuth.credentials(req, { allow: ['user'] });
          const info = await userInfo.getUserInfo(credentials);
          return { user: info.userEntityRef, may: mayAct(info.ownershipEntityRefs, prices.groups) };
        };
        const failed = (res: express.Response, e: unknown) => {
          const name = (e as Error)?.name;
          if (e instanceof PriceError) res.status(400).json({ error: e.message });
          else if (name === 'AuthenticationError') res.status(401).json({ error: 'Sign in to read the prices' });
          else {
            logger.warn(`costs: prices: ${(e as Error).message}`);
            res.status(502).json({ error: (e as Error).message });
          }
        };
        // the values of the chart, kept a minute (the page reads them on every visit)
        let kept: { at: number; values: string; chart: string } | undefined;
        router.get('/prices', async (req, res) => {
          try {
            const w = await asks(req);
            if (!kept || Date.now() - kept.at > 60_000) {
              const [values, chart] = await Promise.all([repo.get(paths.values), repo.get(paths.chart)]);
              kept = { at: Date.now(), values: values.text, chart: chart.text };
            }
            res.json({
              may: w.may,
              groups: prices.groups,
              repo: prices.repo,
              path: paths.values,
              url: `https://github.com/${prices.repo}/blob/${prices.branch}/${paths.values}`,
              version: /^version:\s*"?([^"\s]+)/m.exec(kept.chart)?.[1],
              ...readPrices(kept.values),
            });
          } catch (e) {
            failed(res, e);
          }
        });
        router.post('/prices', express.json({ limit: '64kb' }), async (req, res) => {
          try {
            const w = await asks(req);
            if (!w.may) {
              res.status(403).json({ error: `Only ${prices.groups.join(', ')} may change the prices.` });
              return;
            }
            const changes = readChanges(req.body?.changes);
            const texts = await Promise.all((Object.keys(paths) as Array<keyof PriceFiles>).map(async k => [k, (await repo.get(paths[k])).text] as const));
            const change = priceChange(Object.fromEntries(texts) as PriceFiles, changes, { chart: prices.chart, by: w.user, date: new Date().toISOString().slice(0, 10) });
            // one commit for the five files: the checks of the repository run once
            const pull = await repo.pullRequestInOneCommit(`console/prices-${change.next}-${Date.now().toString(36)}`, change.title, change.body, change.files);
            kept = undefined;
            pulls.forget();
            logger.info(`costs: prices: ${change.changed.length} changed by ${w.user}: pull request #${pull.number}`);
            res.json({ pull, version: change.next, changed: change.changed });
          } catch (e) {
            failed(res, e);
          }
        });
        // the pull requests of the prices and where each one stands
        router.get('/prices/pulls', pullsHandler(pulls, () => ['console/prices-'], asks, m => logger.warn(`costs: prices: ${m}`)));
        httpRouter.use(router);
      },
    });
  },
});
