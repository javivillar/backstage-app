import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { CoreV1Api, CustomObjectsApi, KubeConfig, NetworkingV1Api } from '@kubernetes/client-node';
import { Router } from 'express';
import { type ClusterOverview, prometheusQuery, type Query, readOverview } from './clusterOverview';
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
  // @kubernetes/client-node 0.20 (the version of this package) answers { body }; read items from either shape
  const items = <T>(r: unknown): T[] => (r as { body?: { items?: T[] } }).body?.items ?? (r as { items?: T[] }).items ?? [];
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
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ httpRouter, httpAuth, config, logger }) {
        const prometheus = config.getOptionalString('costs.prometheusUrl')?.replace(/\/+$/, '');
        const query = prometheus ? prometheusQuery(prometheus) : undefined;
        let cache: { at: number; body: ClusterOverview } | undefined;
        let netCache: { at: number; body: ClusterNetwork } | undefined;
        let kc: KubeConfig | undefined;
        if (process.env.KUBERNETES_SERVICE_HOST) {
          kc = new KubeConfig();
          kc.loadFromCluster();
        }

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
        httpRouter.use(router);
      },
    });
  },
});
