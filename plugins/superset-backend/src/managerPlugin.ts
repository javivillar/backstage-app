import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { Request, Router } from 'express';
import { supersetAdminFetch } from './supersetClient';
import {
  ADMIN_GROUP_REF,
  CallerInfo,
  callerSupersetOwnerId,
  connectionOwnerFromExtra,
  listSupersetObjects,
  requireConnectionOwnerOrAdmin,
  requireOwnerOrAdmin,
  SupersetResource,
} from './ownership';

interface SupersetOwner {
  id?: number;
  first_name?: string;
  last_name?: string;
}

function ownerNames(owners: SupersetOwner[] | undefined): string[] {
  return (owners ?? []).map(o => [o.first_name, o.last_name].filter(Boolean).join(' '));
}

/**
 * Backend for the /superset-manager frontend page: lists the Superset
 * connections/datasets/charts/dashboards the caller owns (or everything, if
 * they're a backstage-admin member). Same shape as keycloak-manager, but the
 * owner filter is pushed into Superset's own Rison `q` query instead of
 * fetched-and-filtered client-side (Superset's list endpoints support it
 * natively). Connections/datasets can also be deleted here directly —
 * charts/dashboards can't (deleted natively in Superset, see
 * superset-actions.ts's provision-only rationale).
 */
export const supersetManagerPlugin = createBackendPlugin({
  pluginId: 'superset-manager',
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
        const publicUrl =
          config.getOptionalString('supersetPublicUrl') ??
          config.getOptionalConfig('supersetAdmin')?.getOptionalString('baseUrl') ??
          '';

        async function callerContext(req: Request): Promise<CallerInfo> {
          const credentials = await httpAuth.credentials(req);
          const info = await userInfo.getUserInfo(credentials);
          return {
            entityRef: info.userEntityRef,
            username: info.userEntityRef.split('/').pop() ?? info.userEntityRef,
            isAdmin: info.ownershipEntityRefs.includes(ADMIN_GROUP_REF),
          };
        }

        function listRoute(
          path: string,
          resource: SupersetResource,
          mapItem: (item: Record<string, unknown>) => Record<string, unknown>,
        ) {
          router.get(path, async (req, res) => {
            try {
              const caller = await callerContext(req);
              const items = await listSupersetObjects(config, resource, caller);
              // dataset/chart/dashboard LIST endpoints don't return the
              // native `owners` relation (verified live — only the
              // single-object GET does), so for the admin-only Owner
              // column, fetch each item's full detail. NOT needed for
              // `database`: its ownership (`extra.backstage_owner`) is
              // already present on the list item, and its detail GET
              // doesn't expose `extra` at all anyway (verified live).
              if (caller.isAdmin && resource !== 'database') {
                await Promise.all(
                  items.map(async item => {
                    const detail = await supersetAdminFetch(config, `/api/v1/${resource}/${item.id}`);
                    if (detail.ok) {
                      const body = (await detail.json()) as { result: { owners?: unknown } };
                      item.owners = body.result.owners;
                    }
                  }),
                );
              }
              res.json({ items: items.map(mapItem), isAdmin: caller.isAdmin });
            } catch (e) {
              logger.error(`superset-manager ${path} failed`, e as Error);
              res.status(500).json({ error: (e as Error).message });
            }
          });
        }

        listRoute('/connections', 'database', d => ({
          id: d.id,
          name: d.database_name,
          backend: d.backend,
          owners: [connectionOwnerFromExtra(d.extra)].filter((x): x is string => Boolean(x)),
        }));

        listRoute('/datasets', 'dataset', d => ({
          id: d.id,
          name: d.table_name,
          connection: (d.database as { database_name?: string } | undefined)?.database_name,
          kind: d.kind,
          owners: ownerNames(d.owners as SupersetOwner[] | undefined),
        }));

        listRoute('/charts', 'chart', c => ({
          id: c.id,
          name: c.slice_name,
          vizType: c.viz_type,
          owners: ownerNames(c.owners as SupersetOwner[] | undefined),
          exploreUrl: `${publicUrl}/explore/?slice_id=${c.id}`,
        }));

        listRoute('/dashboards', 'dashboard', d => ({
          id: d.id,
          name: d.dashboard_title,
          owners: ownerNames(d.owners as SupersetOwner[] | undefined),
          dashboardUrl: `${publicUrl}/superset/dashboard/${d.id}/`,
        }));

        function deleteRoute(path: string, resource: 'database' | 'dataset') {
          router.delete(path, async (req, res) => {
            try {
              const caller = await callerContext(req);
              const id = Number(req.params.id);

              if (resource === 'database') {
                // No detail GET for extra (see above) — look it up via the
                // list instead, which already carries it.
                const all = await listSupersetObjects(config, 'database', { ...caller, isAdmin: true });
                const found = all.find(item => item.id === id);
                if (!found) {
                  res.status(404).json({ error: `Superset connection ${id} not found` });
                  return;
                }
                requireConnectionOwnerOrAdmin(caller, connectionOwnerFromExtra(found.extra));
              } else {
                const getRes = await supersetAdminFetch(config, `/api/v1/${resource}/${id}`);
                if (!getRes.ok) {
                  res.status(404).json({ error: `Superset ${resource} ${id} not found` });
                  return;
                }
                const current = (await getRes.json()) as { result: { owners?: SupersetOwner[] } };
                const callerId = await callerSupersetOwnerId(config, caller);
                requireOwnerOrAdmin(caller, callerId, current.result.owners);
              }

              const delRes = await supersetAdminFetch(config, `/api/v1/${resource}/${id}`, { method: 'DELETE' });
              if (!delRes.ok) {
                throw new Error(`${delRes.status} ${await delRes.text()}`);
              }
              res.status(204).send();
            } catch (e) {
              logger.error(`superset-manager DELETE ${path} failed`, e as Error);
              const forbidden = (e as Error).message.startsWith('Forbidden');
              res.status(forbidden ? 403 : 500).json({ error: (e as Error).message });
            }
          });
        }

        deleteRoute('/connections/:id', 'database');
        deleteRoute('/datasets/:id', 'dataset');

        httpRouter.use(router);
        logger.info('superset-manager routes registered: /api/superset-manager/*');
      },
    });
  },
});
