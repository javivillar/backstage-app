import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { AppsV1Api, CoreV1Api, CustomObjectsApi, KubeConfig, NetworkingV1Api } from '@kubernetes/client-node';
import express, { Router } from 'express';
import { readFileSync } from 'fs';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { type ActionRecord, ArgoClient, type ArgoInstance, mayAct, NAME, ownsEntity, WORKLOAD_KINDS } from './clusterActions';
import { summariseZone, type ZoneView } from './clusterZone';
import { GitHubFiles, refuse, type VmPolicy, type VmRequest, vmFileName, workspaceState } from './clusterVms';
import { type ClusterOverview, prometheusQuery, type Query, readOverview } from './clusterOverview';
import { NAMESPACE_NAME, type NamespaceLive, readNamespace } from './clusterNamespace';
import { type K8sEvent, type K8sWorkload, type NamespaceWorkloads, summariseWorkloads } from './clusterWorkloads';
import {
  type CalicoGlobalPolicy,
  type CertManagerCertificate,
  type ClusterNetwork,
  type K8sIngress,
  type K8sNamespace,
  type K8sNetworkPolicy,
  type K8sService,
  summariseNetwork,
  type TraefikTlsStore,
} from './clusterNetwork';

/** Running and ready pods per namespace, from kube-state-metrics (empty without Prometheus). */
async function podsByNamespace(query?: Query): Promise<Record<string, { ready: number; total: number }>> {
  if (!query) return {};
  const [total, ready] = await Promise.all([
    query('count by (namespace) (kube_pod_status_phase{job="kube-state-metrics",phase="Running"} == 1)'),
    query('sum by (namespace) (kube_pod_status_ready{job="kube-state-metrics",condition="true"})'),
  ]);
  const out: Record<string, { ready: number; total: number }> = {};
  for (const s of total) out[s.metric.namespace] = { ready: 0, total: Number(s.value[1]) };
  for (const s of ready) if (out[s.metric.namespace]) out[s.metric.namespace].ready = Math.min(Number(s.value[1]), out[s.metric.namespace].total);
  return out;
}

/** Items of a list answer of @kubernetes/client-node 0.20 ({ body }) or 1.x (the list itself). */
const items = <T>(r: unknown): T[] => (r as { body?: { items?: T[] } }).body?.items ?? (r as { items?: T[] }).items ?? [];

/** Deployments, StatefulSets, DaemonSets and Warning events of one namespace. */
async function readWorkloads(kc: KubeConfig, ns: string): Promise<NamespaceWorkloads> {
  const apps = kc.makeApiClient(AppsV1Api);
  const core = kc.makeApiClient(CoreV1Api);
  const warnings: string[] = [];
  const soft = async <T>(what: string, f: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await f();
    } catch (e) {
      const code = (e as { statusCode?: number; response?: { statusCode?: number } }).statusCode ?? (e as { response?: { statusCode?: number } }).response?.statusCode;
      warnings.push(`${what} could not be read${code ? ` (${code})` : ''}`);
      return [];
    }
  };
  // 0.20 takes the namespace as the first argument (1.x takes { namespace }): call them positionally, as 0.20 expects
  const call = (f: unknown, self: unknown) => (f as (namespace: string) => Promise<unknown>).call(self, ns);
  const [deployments, statefulSets, daemonSets, events] = await Promise.all([
    soft('Deployments', async () => items<K8sWorkload>(await call(apps.listNamespacedDeployment, apps))),
    soft('StatefulSets', async () => items<K8sWorkload>(await call(apps.listNamespacedStatefulSet, apps))),
    soft('DaemonSets', async () => items<K8sWorkload>(await call(apps.listNamespacedDaemonSet, apps))),
    soft('Events', async () => items<K8sEvent>(await call(core.listNamespacedEvent, core))),
  ]);
  return summariseWorkloads({ namespace: ns, deployments, statefulSets, daemonSets, events, warnings });
}

/** Namespaces, Ingresses, NetworkPolicies, Services and Calico global policies, read with the Backstage service account. */
async function readNetwork(kc: KubeConfig, query?: Query): Promise<ClusterNetwork> {
  const core = kc.makeApiClient(CoreV1Api);
  const net = kc.makeApiClient(NetworkingV1Api);
  const custom = kc.makeApiClient(CustomObjectsApi);
  const warnings: string[] = [];
  const soft = async <T>(what: string, f: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await f();
    } catch (e) {
      const code = (e as { statusCode?: number; response?: { statusCode?: number } }).statusCode ?? (e as { response?: { statusCode?: number } }).response?.statusCode;
      warnings.push(`${what} could not be read${code ? ` (${code})` : ''}`);
      return [];
    }
  };
  const listCustom = custom.listClusterCustomObject as unknown as (group: string, version: string, plural: string) => Promise<unknown>;
  const [namespaces, ingresses, policies, services, calico, tlsStores, certificates, pods] = await Promise.all([
    soft('Namespaces', async () => items<K8sNamespace>(await core.listNamespace())),
    soft('Ingresses', async () => items<K8sIngress>(await net.listIngressForAllNamespaces())),
    soft('NetworkPolicies', async () => items<K8sNetworkPolicy>(await net.listNetworkPolicyForAllNamespaces())),
    soft('Services', async () => items<K8sService>(await core.listServiceForAllNamespaces())),
    soft('Calico global policies', async () => items<CalicoGlobalPolicy>(await listCustom.call(custom, 'crd.projectcalico.org', 'v1', 'globalnetworkpolicies'))),
    soft('Traefik TLS stores', async () => items<TraefikTlsStore>(await listCustom.call(custom, 'traefik.io', 'v1alpha1', 'tlsstores'))),
    soft('cert-manager certificates', async () => items<CertManagerCertificate>(await listCustom.call(custom, 'cert-manager.io', 'v1', 'certificates'))),
    podsByNamespace(query).catch(() => {
      warnings.push('Pods per namespace could not be read (Prometheus)');
      return {};
    }),
  ]);
  return summariseNetwork({ namespaces, ingresses, policies, services, calico, tlsStores, certificates, pods, warnings });
}

/**
 * The overview of this cluster for the console (page /console/cluster): nodes, Argo CD applications, volumes.
 *
 *   GET /api/cluster/overview   ClusterOverview (signed-in users; cached 30 s)
 *   GET /api/cluster/network    ClusterNetwork: hosts, segments, namespaces and their policies (signed-in; 30 s)
 *   GET /api/cluster/namespaces/:ns/live   NamespaceLive: pods, restarts, CPU and memory of one namespace (signed-in; 15 s)
 *   GET /api/cluster/namespaces/:ns/workloads   NamespaceWorkloads: Deployments, StatefulSets, DaemonSets and the
 *                                               Warning events of the last hour (signed-in; 15 s; Kubernetes API)
 *   GET /api/cluster/zone       ZoneView: the zone as the OpenNebula host publishes it (topology.json in the ConfigMap
 *                               refresquito-topology of this namespace, every 5 min); read-only
 *   GET /api/cluster/actions[?entity=<ref>]   { allowed, groups, owners, log }: whether the user may act (on that
 *                               entity, as its owner when console.actions.owners), and the last actions
 *   POST /api/cluster/actions/sync     { app }                        sync an Argo CD application with git
 *   POST /api/cluster/actions/restart  { app, namespace, kind, name } restart a workload (Argo CD action)
 *   GET  /api/cluster/zone/vms         { policy, vms, allowed }: the VMs requested from the console and their state
 *   POST /api/cluster/zone/vms         { zone, program, name, size, image }  request a VM (backstage-admin)
 *   POST /api/cluster/zone/vms/delete  { zone, program, name }               delete it
 *        One file per VM in console.vms.dir of console.vms.repo (main): Argo CD syncs console-vms-oneke and
 *        Crossplane (provider-terraform) creates the VM in OpenNebula; its Workspace says how it goes.
 *        Actions: only the groups of console.actions.groups (default backstage-admin), through Argo CD.
 *
 * Config: costs.prometheusUrl (the same Prometheus as the costs). Without it /overview answers 503. /network reads the
 * Kubernetes API with the service account of Backstage (read-only ClusterRole of the chart) when it runs in a cluster.
 */
export default createBackendPlugin({
  pluginId: 'cluster',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        userInfo: coreServices.userInfo,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        catalog: catalogServiceRef,
      },
      async init({ httpRouter, httpAuth, userInfo, config, logger, catalog }) {
        const prometheus = config.getOptionalString('costs.prometheusUrl')?.replace(/\/+$/, '');
        const query = prometheus ? prometheusQuery(prometheus) : undefined;
        let cache: { at: number; body: ClusterOverview } | undefined;
        let netCache: { at: number; body: ClusterNetwork } | undefined;
        const nsCache = new Map<string, { at: number; body: NamespaceLive }>();
        const wlCache = new Map<string, { at: number; body: NamespaceWorkloads }>();
        let kc: KubeConfig | undefined;
        if (process.env.KUBERNETES_SERVICE_HOST) {
          kc = new KubeConfig();
          kc.loadFromCluster();
        }

        // the namespace of this Backstage (the zone ConfigMap lives there)
        let ownNamespace = config.getOptionalString('console.zone.namespace');
        if (!ownNamespace) {
          try {
            ownNamespace = readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/namespace', 'utf8').trim();
          } catch {
            ownNamespace = undefined;
          }
        }
        const zoneConfigMap = config.getOptionalString('console.zone.configMap') ?? 'refresquito-topology';
        let zoneCache: { at: number; body: ZoneView } | undefined;

        // actions: Argo CD with the credentials of the Argo CD plugin; who may act
        const groups = config.getOptionalStringArray('console.actions.groups') ?? ['backstage-admin'];
        // later: the owner of each resource acts on it (off until it is decided)
        const owners = config.getOptionalBoolean('console.actions.owners') ?? false;
        const argoCfg = config.getOptionalConfigArray('argocd.appLocatorMethods')?.[0]?.getOptionalConfigArray('instances')?.[0];
        const argoInstance: ArgoInstance | undefined = argoCfg
          ? {
              url: argoCfg.getString('url').replace(/\/+$/, ''),
              token: argoCfg.getOptionalString('token') || undefined,
              username: argoCfg.getOptionalString('username'),
              password: argoCfg.getOptionalString('password'),
            }
          : undefined;
        const argo = argoInstance ? new ArgoClient(argoInstance) : undefined;
        const actionLog: ActionRecord[] = [];
        const record = (r: ActionRecord) => {
          actionLog.unshift(r);
          actionLog.splice(100);
          logger.info(`console action ${r.action} ${r.target} by ${r.user}: ${r.result}${r.message ? ` (${r.message})` : ''}`);
        };
        /** Who asks, whether they may act on anything (groups), and on what entity they may act as its owner. */
        const actor = async (req: express.Request, entityRef?: string) => {
          const credentials = await httpAuth.credentials(req, { allow: ['user'] });
          const info = await userInfo.getUserInfo(credentials);
          const admin = mayAct(info.ownershipEntityRefs, groups);
          let owned: { namespace?: string; app: string } | undefined;
          if (!admin && owners && entityRef) {
            const entity = await catalog.getEntityByRef(entityRef, { credentials }).catch(() => undefined);
            const owner = (entity?.spec as { owner?: string } | undefined)?.owner;
            if (entity && ownsEntity(info.ownershipEntityRefs, owner)) {
              owned = { namespace: entity.metadata.annotations?.['refresquito.io/namespace'], app: entity.metadata.name };
            }
          }
          return { user: info.userEntityRef, allowed: admin || !!owned, admin, owned };
        };

        // the VMs requested from the console, as code: files of console-vms-oneke in refresquito-services (main)
        const ghToken = config.getOptionalConfigArray('integrations.github')?.[0]?.getOptionalString('token');
        const vmRepo = new GitHubFiles(config.getOptionalString('console.vms.repo') ?? 'javivillar/refresquito-services', config.getOptionalString('console.vms.branch') ?? 'main', ghToken);
        const vmChart = config.getOptionalString('console.vms.chart') ?? 'charts/console-vms-oneke';
        const readRequests = async (): Promise<{ policy: VmPolicy; vms: Array<VmRequest & { file: string; sha: string }> }> => {
          const [policy, files] = await Promise.all([vmRepo.get(`${vmChart}/policy.json`), vmRepo.list(`${vmChart}/vms`)]);
          const vms = await Promise.all(
            files.filter(f => f.name.endsWith('.json')).map(async f => ({ ...(JSON.parse((await vmRepo.get(f.path)).text) as VmRequest), file: f.path, sha: f.sha })),
          );
          return { policy: JSON.parse(policy.text) as VmPolicy, vms };
        };
        const readWorkspaces = async () => {
          if (!kc || !ownNamespace) return new Map<string, ReturnType<typeof workspaceState>>();
          const custom = kc.makeApiClient(CustomObjectsApi);
          const list = custom.listNamespacedCustomObject as unknown as (g: string, v: string, ns: string, plural: string) => Promise<unknown>;
          try {
            const r = await list.call(custom, 'tf.m.crossplane.io', 'v1beta1', ownNamespace, 'workspaces');
            const workspaces = items<Parameters<typeof workspaceState>[0]>(r);
            return new Map(workspaces.filter(w => w.metadata.labels?.['refresquito.io/console-vm'] === 'true').map(w => [w.metadata.name, workspaceState(w)]));
          } catch {
            return new Map<string, ReturnType<typeof workspaceState>>();
          }
        };

        /** The zone as the host publishes it (cached 1 min); undefined while it has not published topology.json. */
        const readZone = async (): Promise<ZoneView | undefined> => {
          if (!kc || !ownNamespace) return undefined;
          if (!zoneCache || Date.now() - zoneCache.at > 60_000) {
            const core = kc.makeApiClient(CoreV1Api);
            const read = core.readNamespacedConfigMap as unknown as (name: string, namespace: string) => Promise<unknown>;
            const r = (await read.call(core, zoneConfigMap, ownNamespace)) as { body?: { data?: Record<string, string> }; data?: Record<string, string> };
            const json = (r.body?.data ?? r.data ?? {})['topology.json'];
            if (!json) return undefined;
            zoneCache = { at: Date.now(), body: summariseZone(JSON.parse(json)) };
          }
          return zoneCache.body;
        };
        const zonePrograms = async (): Promise<string[]> => ((await readZone())?.zones ?? []).flatMap(z => z.programs.map(p => `${z.name}/${p.name}`));

        const router = Router();
        router.use(express.json({ limit: '16kb' }));
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
        router.get('/network', async (req, res) => {
          try {
            await httpAuth.credentials(req, { allow: ['user'] });
          } catch {
            res.status(401).json({ error: 'Sign in to read the cluster' });
            return;
          }
          if (!kc) {
            res.status(503).json({ error: 'Backstage does not run inside the cluster: the network cannot be read.' });
            return;
          }
          try {
            if (!netCache || Date.now() - netCache.at > 30_000) netCache = { at: Date.now(), body: await readNetwork(kc, query) };
            res.json(netCache.body);
          } catch (e) {
            logger.error(`cluster network: ${(e as Error).message}`);
            res.status(502).json({ error: `The network could not be read: ${(e as Error).message}` });
          }
        });
        router.get('/namespaces/:ns/live', async (req, res) => {
          try {
            await httpAuth.credentials(req, { allow: ['user'] });
          } catch {
            res.status(401).json({ error: 'Sign in to read the cluster' });
            return;
          }
          const ns = req.params.ns;
          if (!NAMESPACE_NAME.test(ns)) {
            res.status(400).json({ error: 'Not a namespace name' });
            return;
          }
          if (!query) {
            res.status(503).json({ error: 'No Prometheus configured (costs.prometheusUrl).' });
            return;
          }
          try {
            const hit = nsCache.get(ns);
            if (hit && Date.now() - hit.at < 15_000) {
              res.json(hit.body);
              return;
            }
            const body = await readNamespace(query, ns);
            if (nsCache.size > 200) nsCache.clear();
            nsCache.set(ns, { at: Date.now(), body });
            res.json(body);
          } catch (e) {
            logger.error(`cluster namespace ${ns}: ${(e as Error).message}`);
            res.status(502).json({ error: `Prometheus did not answer: ${(e as Error).message}` });
          }
        });
        router.get('/namespaces/:ns/workloads', async (req, res) => {
          try {
            await httpAuth.credentials(req, { allow: ['user'] });
          } catch {
            res.status(401).json({ error: 'Sign in to read the cluster' });
            return;
          }
          const ns = req.params.ns;
          if (!NAMESPACE_NAME.test(ns)) {
            res.status(400).json({ error: 'Not a namespace name' });
            return;
          }
          if (!kc) {
            res.status(503).json({ error: 'Backstage does not run inside the cluster: the workloads cannot be read.' });
            return;
          }
          try {
            const hit = wlCache.get(ns);
            if (hit && Date.now() - hit.at < 15_000) {
              res.json(hit.body);
              return;
            }
            const body = await readWorkloads(kc, ns);
            if (wlCache.size > 200) wlCache.clear();
            wlCache.set(ns, { at: Date.now(), body });
            res.json(body);
          } catch (e) {
            logger.error(`cluster workloads ${ns}: ${(e as Error).message}`);
            res.status(502).json({ error: `The workloads could not be read: ${(e as Error).message}` });
          }
        });
        router.get('/zone', async (req, res) => {
          try {
            await httpAuth.credentials(req, { allow: ['user'] });
          } catch {
            res.status(401).json({ error: 'Sign in to read the zone' });
            return;
          }
          if (!kc || !ownNamespace) {
            res.status(503).json({ error: 'Backstage does not run inside the cluster: the zone cannot be read.' });
            return;
          }
          try {
            const zone = await readZone();
            if (!zone) {
              res.status(404).json({ error: `The host has not published topology.json in ${zoneConfigMap} yet (opennebula: topology-publish).` });
              return;
            }
            res.json(zone);
          } catch (e) {
            logger.error(`cluster zone: ${(e as Error).message}`);
            res.status(502).json({ error: `The zone could not be read: ${(e as Error).message}` });
          }
        });

        router.get('/actions', async (req, res) => {
          try {
            const entity = typeof req.query.entity === 'string' ? req.query.entity : undefined;
            const { allowed, admin } = await actor(req, entity);
            res.json({ allowed: allowed && !!argo, groups, owners, configured: !!argo, log: admin ? actionLog.slice(0, 30) : actionLog.filter(a => entity && a.target.includes(entity.split('/').pop()!)).slice(0, 30) });
          } catch {
            res.status(401).json({ error: 'Sign in' });
          }
        });

        type Who = Awaited<ReturnType<typeof actor>>;
        const act = (
          name: string,
          run: (body: Record<string, unknown>) => { target: string; namespace?: string; app: string; go: () => Promise<void> } | string,
        ) =>
          router.post(`/actions/${name}`, async (req, res) => {
            let who: Who;
            try {
              who = await actor(req, typeof req.body?.entity === 'string' ? req.body.entity : undefined);
            } catch {
              res.status(401).json({ error: 'Sign in' });
              return;
            }
            if (!who.allowed) {
              res.status(403).json({ error: `Only ${groups.join(', ')}${owners ? ' or the owner of the service' : ''} can do this.` });
              return;
            }
            if (!argo) {
              res.status(503).json({ error: 'Argo CD is not configured (argocd.appLocatorMethods).' });
              return;
            }
            const plan = run((req.body ?? {}) as Record<string, unknown>);
            if (typeof plan === 'string') {
              res.status(400).json({ error: plan });
              return;
            }
            // an owner acts only on what belongs to their entity: its namespace, its Argo CD application
            if (!who.admin && who.owned) {
              const mine = plan.namespace ? plan.namespace === who.owned.namespace : plan.app === who.owned.app;
              if (!mine) {
                res.status(403).json({ error: 'As its owner you can act only on the namespace and application of your service.' });
                return;
              }
            }
            try {
              await plan.go();
              record({ at: new Date().toISOString(), user: who.user, action: name, target: plan.target, result: 'done' });
              res.json({ ok: true });
            } catch (e) {
              record({ at: new Date().toISOString(), user: who.user, action: name, target: plan.target, result: 'failed', message: (e as Error).message });
              res.status(502).json({ error: (e as Error).message });
            }
          });
        act('sync', b => {
          const app = String(b.app ?? '');
          if (!NAME.test(app)) return 'app: the name of an Argo CD application';
          return { target: app, app, go: () => argo!.sync(app) };
        });
        act('restart', b => {
          const [app, namespace, kind, name] = [b.app, b.namespace, b.kind, b.name].map(v => String(v ?? ''));
          if (!NAME.test(app) || !NAMESPACE_NAME.test(namespace) || !NAME.test(name)) return 'app, namespace and name are names';
          if (!(WORKLOAD_KINDS as readonly string[]).includes(kind)) return `kind is one of ${WORKLOAD_KINDS.join(', ')}`;
          return { target: `${kind} ${namespace}/${name} (${app})`, namespace, app, go: () => argo!.restart(app, namespace, kind, name) };
        });

        router.get('/zone/vms', async (req, res) => {
          try {
            const { admin } = await actor(req);
            const [{ policy, vms }, states] = await Promise.all([readRequests(), readWorkspaces()]);
            res.json({
              policy,
              allowed: admin,
              vms: vms.map(({ sha: _sha, file: _file, ...v }) => ({ ...v, state: states.get(`vm-${v.zone}-${v.program}-${v.name}`) })),
            });
          } catch (e) {
            res.status(502).json({ error: (e as Error).message });
          }
        });
        const vmAction = (path: string, run: (b: Record<string, string>, user: string) => Promise<string>) =>
          router.post(path, async (req, res) => {
            let who: Awaited<ReturnType<typeof actor>>;
            try {
              who = await actor(req);
            } catch {
              res.status(401).json({ error: 'Sign in' });
              return;
            }
            if (!who.admin) {
              res.status(403).json({ error: `Only ${groups.join(', ')} can create or delete VMs.` });
              return;
            }
            try {
              const body = Object.fromEntries(Object.entries(req.body ?? {}).map(([k, v]) => [k, String(v)]));
              const message = await run(body, who.user);
              if (message.startsWith('!')) {
                res.status(400).json({ error: message.slice(1) });
                return;
              }
              record({ at: new Date().toISOString(), user: who.user, action: 'vm', target: message, result: 'done' });
              res.json({ ok: true });
            } catch (e) {
              res.status(502).json({ error: (e as Error).message });
            }
          });
        vmAction('/zone/vms', async (b, user) => {
          const v: VmRequest = { zone: b.zone, program: b.program, name: b.name, size: b.size, image: b.image, requested_by: user, requested_at: new Date().toISOString() };
          const { policy, vms } = await readRequests();
          const no = refuse(policy, vms, v, await zonePrograms());
          if (no) return `!${no}`;
          const message = `console: create VM ${v.name} in ${v.zone}/${v.program} (${v.size}, ${v.image})`;
          await vmRepo.put(`${vmChart}/vms/${vmFileName(v)}`, `${JSON.stringify(v, null, 2)}\n`, `${message} (by ${user})`);
          return message;
        });
        vmAction('/zone/vms/delete', async (b, user) => {
          const { vms } = await readRequests();
          const v = vms.find(x => x.zone === b.zone && x.program === b.program && x.name === b.name);
          if (!v) return `!There is no VM ${b.name} in ${b.zone}/${b.program}.`;
          const message = `console: delete VM ${v.name} in ${v.zone}/${v.program}`;
          await vmRepo.remove(v.file, v.sha, `${message} (by ${user})`);
          return message;
        });

        httpRouter.use(router);
      },
    });
  },
});
