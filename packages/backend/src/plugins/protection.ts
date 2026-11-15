/**
 * Data continuity of the applications, for the console (Portal › Business management › Data continuity and the tab
 * Data continuity of an application). See protectionModel.ts.
 *
 *   GET  /api/protection          {available, reason?, store, plans, apps[], usage, may, groups, repo, path, url}
 *   GET  /api/protection/usage    {available, namespaces: {ns: {snapshotBytes, backupBytes, plan}}}   (the cost pages)
 *   POST /api/protection/plans    {changes: {app: plan}} -> a pull request on the chart protection-oneke
 *   GET  /api/protection/pulls    {pulls}: the pull requests of the plans and their state (consolePulls.ts)
 *
 * Reads, with the service account of Backstage: the ConfigMap protection-plans and the Velero objects (Backups,
 * DataUploads, BackupStorageLocations) of the namespace of protection-oneke, the PersistentVolumeClaims of the
 * cluster and the Snapshots of Longhorn. Read only: taking a snapshot or a backup now, and restoring, are not here.
 *
 * app-config: protection.namespace (default: <prefix>protection-oneke, from the namespace of this Backstage),
 * protection.longhornNamespace (longhorn-system), protection.repo / branch / chart (the repository of the chart),
 * protection.groups (who may change plans, besides backstage-admin and console.actions.groups).
 */
import { readFileSync } from 'fs';
import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { CoreV1Api, CustomObjectsApi, KubeConfig } from '@kubernetes/client-node';
import express from 'express';
import Router from 'express-promise-router';
import { mayAct } from './clusterActions';
import { GitHubFiles } from './clusterVms';
import { cancelHandler, PullReader, pullsHandler } from './consolePulls';
import { PriceError, PriceFiles, pricePaths } from './costPrices';
import { backupOf, Declared, planChange, protectionView, pvcOf, readDeclared, readPlanChanges, Snapshot, snapshotOf, usageOf } from './protectionModel';

const items = (r: unknown): any[] => (r as any)?.body?.items ?? (r as any)?.items ?? [];

export default createBackendPlugin({
  pluginId: 'protection',
  register(env) {
    env.registerInit({
      deps: { httpRouter: coreServices.httpRouter, httpAuth: coreServices.httpAuth, userInfo: coreServices.userInfo, config: coreServices.rootConfig, logger: coreServices.logger },
      async init({ httpRouter, httpAuth, userInfo, config, logger }) {
        let kc: KubeConfig | undefined;
        let own = config.getOptionalString('console.zone.namespace');
        if (process.env.KUBERNETES_SERVICE_HOST) {
          kc = new KubeConfig();
          kc.loadFromCluster();
          try {
            own = own ?? readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/namespace', 'utf8').trim();
          } catch {
            // no namespace file: protection.namespace says where the chart is
          }
        }
        const prefix = own?.endsWith('cnoe-oneke') ? own.slice(0, -'cnoe-oneke'.length) : '';
        const namespace = config.getOptionalString('protection.namespace') ?? `${prefix}protection-oneke`;
        const longhorn = config.getOptionalString('protection.longhornNamespace') ?? 'longhorn-system';
        const repoName = config.getOptionalString('protection.repo') ?? config.getOptionalString('console.manage.repo') ?? 'javivillar/refresquito-services';
        const branch = config.getOptionalString('protection.branch') ?? 'main';
        const chart = config.getOptionalString('protection.chart') ?? 'protection-oneke';
        const groups = [...new Set(['backstage-admin', ...(config.getOptionalStringArray('console.actions.groups') ?? []), ...(config.getOptionalStringArray('protection.groups') ?? [])])];
        const repo = new GitHubFiles(repoName, branch, config.getOptionalConfigArray('integrations.github')?.[0]?.getOptionalString('token'));
        const pulls = new PullReader(repoName, branch, config.getOptionalConfigArray('integrations.github')?.[0]?.getOptionalString('token'));
        const paths = pricePaths(chart);

        type Read = { available: boolean; reason?: string; declared?: Declared; store?: Record<string, unknown>; apps: ReturnType<typeof protectionView> };
        let kept: { at: number; body: Read } | undefined;
        const read = async (): Promise<Read> => {
          if (kept && Date.now() - kept.at < 30_000) return kept.body;
          let body: Read;
          if (!kc) body = { available: false, reason: 'Backstage is not running in a cluster.', apps: [] };
          else {
            const core = kc.makeApiClient(CoreV1Api);
            const custom = kc.makeApiClient(CustomObjectsApi);
            const list = custom.listNamespacedCustomObject as unknown as (g: string, v: string, ns: string, plural: string) => Promise<unknown>;
            const readMap = core.readNamespacedConfigMap as unknown as (name: string, ns: string) => Promise<unknown>;
            const soft = async (what: string, f: () => Promise<unknown>) => {
              try {
                return items(await f());
              } catch (e) {
                logger.warn(`protection: ${what} could not be read: ${(e as Error).message}`);
                return [];
              }
            };
            let declared: Declared | undefined;
            try {
              const r = (await readMap.call(core, 'protection-plans', namespace)) as any;
              declared = readDeclared((r?.body?.data ?? r?.data ?? {})['protection.json'] ?? '');
            } catch (e) {
              logger.info(`protection: no plans in ${namespace}: ${(e as Error).message}`);
            }
            if (!declared) body = { available: false, reason: `protection-oneke is not installed in this cluster (no ConfigMap protection-plans in ${namespace}).`, apps: [] };
            else {
              const [pvcs, snaps, backups, uploads, locations] = await Promise.all([
                soft('volumes', () => core.listPersistentVolumeClaimForAllNamespaces()),
                soft('Longhorn snapshots', () => list.call(custom, 'longhorn.io', 'v1beta2', longhorn, 'snapshots')),
                soft('Velero backups', () => list.call(custom, 'velero.io', 'v1', namespace, 'backups')),
                soft('Velero data uploads', () => list.call(custom, 'velero.io', 'v2alpha1', namespace, 'datauploads')),
                soft('the backup store', () => list.call(custom, 'velero.io', 'v1', namespace, 'backupstoragelocations')),
              ]);
              const location = locations.find(l => l?.metadata?.name === 'default');
              body = {
                available: true,
                declared,
                store: { ...declared.store, phase: location?.status?.phase, validated: location?.status?.lastValidationTime, message: location?.status?.message },
                apps: protectionView(declared, prefix, pvcs.map(pvcOf), snaps.map(snapshotOf).filter((s): s is Snapshot => Boolean(s)), backups.map(b => backupOf(b, uploads))),
              };
            }
          }
          kept = { at: Date.now(), body };
          return body;
        };

        const asks = async (req: express.Request) => {
          const info = await userInfo.getUserInfo(await httpAuth.credentials(req, { allow: ['user'] }));
          return { user: info.userEntityRef, may: mayAct(info.ownershipEntityRefs, groups) };
        };
        const failed = (res: express.Response, e: unknown) => {
          if (e instanceof PriceError) res.status(400).json({ error: e.message });
          else if ((e as Error)?.name === 'AuthenticationError') res.status(401).json({ error: 'Sign in to read the data continuity' });
          else {
            logger.warn(`protection: ${(e as Error).message}`);
            res.status(502).json({ error: (e as Error).message });
          }
        };

        const router = Router();
        router.get('/', async (req, res) => {
          try {
            const w = await asks(req);
            const r = await read();
            res.json({
              available: r.available,
              reason: r.reason,
              store: r.store,
              plans: r.declared?.plans ?? {},
              apps: r.apps,
              may: w.may,
              groups,
              repo: repoName,
              path: paths.values,
              url: `https://github.com/${repoName}/blob/${branch}/${paths.values}`,
            });
          } catch (e) {
            failed(res, e);
          }
        });
        router.get('/usage', async (req, res) => {
          try {
            await httpAuth.credentials(req, { allow: ['user'] });
            const r = await read();
            res.json({ available: r.available, namespaces: usageOf(r.apps) });
          } catch (e) {
            failed(res, e);
          }
        });
        router.post('/plans', express.json({ limit: '16kb' }), async (req, res) => {
          try {
            const w = await asks(req);
            if (!w.may) {
              res.status(403).json({ error: `Only ${groups.join(', ')} may change the protection plans.` });
              return;
            }
            const changes = readPlanChanges(req.body?.changes);
            const texts = await Promise.all((Object.keys(paths) as Array<keyof PriceFiles>).map(async k => [k, (await repo.get(paths[k])).text] as const));
            const change = planChange(Object.fromEntries(texts) as PriceFiles, changes, { chart, by: w.user, date: new Date().toISOString().slice(0, 10) });
            const pull = await repo.pullRequestInOneCommit(`console/protection-${change.next}-${Date.now().toString(36)}`, change.title, change.body, change.files);
            pulls.forget();
            logger.info(`protection: ${change.changed.length} plans changed by ${w.user}: pull request #${pull.number}`);
            res.json({ pull, version: change.next, changed: change.changed });
          } catch (e) {
            failed(res, e);
          }
        });
        // the pull requests of the plans and where each one stands
        router.get('/pulls', pullsHandler(pulls, () => ['console/protection-'], asks, m => logger.warn(`protection: ${m}`)));
        router.post('/pulls/:number/cancel', cancelHandler(pulls, () => ['console/protection-'], asks, m => logger.info(`protection: ${m}`)));
        httpRouter.use(router);
      },
    });
  },
});
