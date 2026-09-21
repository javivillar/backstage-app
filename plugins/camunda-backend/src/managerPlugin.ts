import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { Request, Router } from 'express';
import { camundaFetch, camundaPublicUrl, deleteAllProcessDefinitionVersions } from './camundaClient';
import { ADMIN_GROUP_REF, CallerInfo, ownerMap, requireOwnerOrAdmin } from './ownership';

interface ProcessDefinition {
  id: string;
  key: string;
  name?: string;
  version: number;
}

/**
 * Backend for the /camunda-manager frontend page: lists the process
 * definitions the caller provisioned through Backstage (or everything, if
 * they're a backstage-admin member). Same shape as keycloak-manager/
 * superset-manager, but the ownership filter comes from Camunda's own
 * native authorization table (see ownership.ts) rather than a bolted-on
 * attribute.
 */
export const camundaManagerPlugin = createBackendPlugin({
  pluginId: 'camunda-manager',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        userInfo: coreServices.userInfo,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ httpRouter, httpAuth, userInfo, config, logger }) {
        const router = Router();

        async function callerContext(req: Request): Promise<CallerInfo> {
          const credentials = await httpAuth.credentials(req);
          const info = await userInfo.getUserInfo(credentials);
          return {
            entityRef: info.userEntityRef,
            username: info.userEntityRef.split('/').pop() ?? info.userEntityRef,
            isAdmin: info.ownershipEntityRefs.includes(ADMIN_GROUP_REF),
          };
        }

        router.get('/process-definitions', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const defsRes = await camundaFetch(config, '/process-definition?latestVersion=true');
            if (!defsRes.ok) {
              throw new Error(
                `Failed to list Camunda process definitions: ${defsRes.status} ${await defsRes.text()}`,
              );
            }
            const allDefs = (await defsRes.json()) as ProcessDefinition[];
            const owners = await ownerMap(config);
            const publicUrl = camundaPublicUrl(config);

            const items = allDefs
              .filter(d => caller.isAdmin || owners[d.key] === caller.username)
              .map(d => ({
                id: d.id,
                key: d.key,
                name: d.name ?? d.key,
                version: d.version,
                owner: owners[d.key],
                cockpitUrl: `${publicUrl}/camunda/app/cockpit/default/#/process-definition/${d.id}`,
              }));

            res.json({ items, isAdmin: caller.isAdmin });
          } catch (e) {
            logger.error('camunda-manager /process-definitions failed', e as Error);
            res.status(500).json({ error: (e as Error).message });
          }
        });

        router.delete('/process-definitions/:key', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const key = req.params.key;
            await requireOwnerOrAdmin(config, caller, key);

            await deleteAllProcessDefinitionVersions(config, key);
            res.status(204).send();
          } catch (e) {
            logger.error('camunda-manager DELETE /process-definitions failed', e as Error);
            const forbidden = (e as Error).message.startsWith('Forbidden');
            res.status(forbidden ? 403 : 500).json({ error: (e as Error).message });
          }
        });

        httpRouter.use(router);
        logger.info('camunda-manager routes registered: /api/camunda-manager/*');
      },
    });
  },
});
