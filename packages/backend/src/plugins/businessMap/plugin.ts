import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { Router } from 'express';
import { checkProcess, ContinuityGraph, continuityOf, type MapEntity, readDefaults } from './continuityModel';
import { createExercisesRouter } from './exercisesRouter';
import { createPreviewRouter } from './previewRouter';

/**
 * The business map (docs/business-map.md): the kinds BusinessProcess and ReferenceModel in the catalog, and the
 * continuity check of the chain under each process.
 *
 *   GET /api/business-map/continuity?entity=<ref>   { entity, requirement, delivers, result, gaps }: the strictest
 *       requirement of the processes that depend on the entity, checked against its sla-rpo / sla-rto
 *   GET /api/business-map/processes/:namespace/:name/check   { process, requirement, elements }: every element of the
 *       chain of a process (production only), checked
 *
 * Config: businessMap.criticality (rpo, rto, ha of critical / important / standard), rendered by cnoe-oneke.
 */

/** What the routes read of the catalog: the processes and every System, Component and Resource. */
const FIELDS = ['kind', 'metadata.name', 'metadata.namespace', 'metadata.title', 'metadata.annotations', 'spec.type', 'spec.criticality', 'spec.rpo', 'spec.rto', 'relations'];

export const businessMapPlugin = createBackendPlugin({
  pluginId: 'business-map',
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
        const defaults = readDefaults(config.getOptional('businessMap.criticality'));
        if (!Object.keys(defaults).length) logger.warn('business-map: no businessMap.criticality, only the rpo/rto of each process count');

        const graphFor = async (credentials: Awaited<ReturnType<typeof httpAuth.credentials>>) => {
          const { items } = await catalog.getEntities(
            { filter: [{ kind: 'businessprocess' }, { kind: 'system' }, { kind: 'component' }, { kind: 'resource' }], fields: FIELDS },
            { credentials },
          );
          return new ContinuityGraph(items as MapEntity[], defaults);
        };

        const router = Router();
        router.get('/continuity', async (req, res) => {
          try {
            const credentials = await httpAuth.credentials(req, { allow: ['user', 'service'] });
            const entity = typeof req.query.entity === 'string' ? req.query.entity : '';
            if (!/^[a-z0-9]+:[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(entity)) {
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

        // POST /import/preview (previewRouter.ts) and POST /exercises (exercisesRouter.ts)
        router.use(createPreviewRouter({ httpAuth, userInfo, config, logger, catalog }), createExercisesRouter({ httpAuth, userInfo, config, logger, catalog }));
        httpRouter.use(router);
      },
    });
  },
});
