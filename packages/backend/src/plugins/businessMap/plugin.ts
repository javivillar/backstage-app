import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { Router } from 'express';
import { checkProcess, ContinuityGraph, continuityOf, type MapEntity, readDefaults } from './continuityModel';
import { buildMap, engineLinks, impactOf } from './mapModel';

/**
 * The business map (docs/business-map.md): the kinds BusinessProcess and ReferenceModel in the catalog, and the
 * continuity check of the chain under each process.
 *
 *   GET /api/business-map/continuity?entity=<ref>   { entity, requirement, delivers, result, gaps }: the strictest
 *       requirement of the processes that depend on the entity, checked against its sla-rpo / sla-rto
 *   GET /api/business-map/processes/:namespace/:name/check   { process, requirement, elements }: every element of the
 *       chain of a process (production only), checked
 *   GET /api/business-map/map?namespace=<customer>   { namespace, namespaces, models, defaults, domains, processes }:
 *       the domains and processes of one customer, each checked (the map, the heat map and the matrix read it)
 *   GET /api/business-map/impact?entity=<ref>   { entity, role, delivers, processes, support?, services? }: the
 *       processes that depend on an element, strictest first; for a framework line or a development service, who runs on it
 *   GET /api/business-map/engine?key=<process key>   { baseUrl?, cockpitUrl?, tasklistUrl?, definitionUrl? }: the
 *       links into the process engine (Operaton) for the BPMN of a process
 *
 * Config: businessMap.criticality (rpo, rto, ha of critical / important / standard), rendered by cnoe-oneke;
 * camundaPublicUrl (the browser URL of Operaton, the key kept from Camunda) and camundaAdmin (its engine-rest).
 */

/** What the routes read of the catalog: the processes and every System, Component and Resource. */
const FIELDS = ['kind', 'metadata.name', 'metadata.namespace', 'metadata.title', 'metadata.annotations', 'spec.type', 'spec.criticality', 'spec.rpo', 'spec.rto', 'relations'];
/** What the pages read besides: the Domains and ReferenceModels too, with what the map shows of each. */
const MAP_FIELDS = [
  ...FIELDS,
  'metadata.description',
  'spec.owner',
  'spec.domain',
  'spec.retention',
  'spec.classification',
  'spec.subdomainOf',
  'spec.lifecycle',
  'spec.source',
  'spec.industry',
  'spec.version',
  'spec.namespace',
];
const REF = /^[a-z0-9]+:[a-z0-9._-]+\/[a-z0-9._-]+$/i;
const KEY = /^[A-Za-z0-9._-]{1,255}$/;

export const businessMapPlugin = createBackendPlugin({
  pluginId: 'business-map',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        catalog: catalogServiceRef,
      },
      async init({ httpRouter, httpAuth, config, logger, catalog }) {
        const defaults = readDefaults(config.getOptional('businessMap.criticality'));
        if (!Object.keys(defaults).length) logger.warn('business-map: no businessMap.criticality, only the rpo/rto of each process count');

        const graphFor = async (credentials: Awaited<ReturnType<typeof httpAuth.credentials>>) => {
          const { items } = await catalog.getEntities(
            { filter: [{ kind: 'businessprocess' }, { kind: 'system' }, { kind: 'component' }, { kind: 'resource' }], fields: FIELDS },
            { credentials },
          );
          return new ContinuityGraph(items as MapEntity[], defaults);
        };

        /** The whole map: processes, Domains, ReferenceModels and every System, Component and Resource. */
        const mapGraphFor = async (credentials: Awaited<ReturnType<typeof httpAuth.credentials>>) => {
          const { items } = await catalog.getEntities(
            {
              filter: [{ kind: 'businessprocess' }, { kind: 'referencemodel' }, { kind: 'domain' }, { kind: 'system' }, { kind: 'component' }, { kind: 'resource' }],
              fields: MAP_FIELDS,
            },
            { credentials },
          );
          return new ContinuityGraph(items as MapEntity[], defaults);
        };

        /** The id of the latest definition of a process key in Operaton, undefined when it cannot tell. */
        const definitionIdOf = async (key: string): Promise<string | undefined> => {
          const base = config.getOptionalString('camundaAdmin.baseUrl');
          const user = config.getOptionalString('camundaAdmin.username');
          const password = config.getOptionalString('camundaAdmin.password');
          if (!base || !user || !password) return undefined;
          try {
            const res = await fetch(`${base.replace(/\/+$/, '')}/engine-rest/process-definition/key/${encodeURIComponent(key)}`, {
              headers: { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` },
              signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) return undefined;
            const body = (await res.json()) as { id?: unknown };
            return typeof body.id === 'string' ? body.id : undefined;
          } catch (e) {
            logger.info(`business-map: no definition of ${key} in the engine: ${(e as Error).message}`);
            return undefined;
          }
        };

        const router = Router();
        router.get('/continuity', async (req, res) => {
          try {
            const credentials = await httpAuth.credentials(req, { allow: ['user', 'service'] });
            const entity = typeof req.query.entity === 'string' ? req.query.entity : '';
            if (!REF.test(entity)) {
              res.status(400).json({ error: 'entity is a full entity reference: kind:namespace/name.' });
              return;
            }
            res.json(continuityOf(await graphFor(credentials), entity));
          } catch (e) {
            logger.warn(`business-map: ${(e as Error).message}`);
            res.status(502).json({ error: (e as Error).message });
          }
        });

        router.get('/processes/:namespace/:name/check', async (req, res) => {
          try {
            const credentials = await httpAuth.credentials(req, { allow: ['user', 'service'] });
            const check = checkProcess(await graphFor(credentials), `businessprocess:${req.params.namespace}/${req.params.name}`);
            if (!check) {
              res.status(404).json({ error: `There is no business process ${req.params.namespace}/${req.params.name} with a criticality.` });
              return;
            }
            res.json(check);
          } catch (e) {
            logger.warn(`business-map: ${(e as Error).message}`);
            res.status(502).json({ error: (e as Error).message });
          }
        });

        router.get('/map', async (req, res) => {
          try {
            const credentials = await httpAuth.credentials(req, { allow: ['user', 'service'] });
            const namespace = typeof req.query.namespace === 'string' && req.query.namespace ? req.query.namespace : undefined;
            res.json(buildMap(await mapGraphFor(credentials), defaults, namespace));
          } catch (e) {
            logger.warn(`business-map: ${(e as Error).message}`);
            res.status(502).json({ error: (e as Error).message });
          }
        });

        router.get('/impact', async (req, res) => {
          try {
            const credentials = await httpAuth.credentials(req, { allow: ['user', 'service'] });
            const entity = typeof req.query.entity === 'string' ? req.query.entity : '';
            if (!REF.test(entity)) {
              res.status(400).json({ error: 'entity is a full entity reference: kind:namespace/name.' });
              return;
            }
            res.json(impactOf(await mapGraphFor(credentials), entity));
          } catch (e) {
            logger.warn(`business-map: ${(e as Error).message}`);
            res.status(502).json({ error: (e as Error).message });
          }
        });

        router.get('/engine', async (req, res) => {
          try {
            await httpAuth.credentials(req, { allow: ['user', 'service'] });
            const key = typeof req.query.key === 'string' && KEY.test(req.query.key) ? req.query.key : undefined;
            const publicUrl = config.getOptionalString('camundaPublicUrl');
            const id = key && publicUrl ? await definitionIdOf(key) : undefined;
            res.json(engineLinks(publicUrl, id));
          } catch (e) {
            logger.warn(`business-map: ${(e as Error).message}`);
            res.status(502).json({ error: (e as Error).message });
          }
        });

        httpRouter.use(router);
      },
    });
  },
});
