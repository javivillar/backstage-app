import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import express, { Request, Router } from 'express';
import { alfrescoFetch } from './alfrescoClient';
import { ADMIN_GROUP_REF, CallerInfo, isSiteRole, requireSiteManagerOrAdmin } from './alfrescoAuthz';

/**
 * Backend for the /alfresco-manager frontend page: lists the Alfresco
 * Sites the caller manages (or all sites, if they're a backstage-admin
 * member), and backs delete + the per-site Members dialog. Same shape as
 * camunda-manager/seaweedfs-manager, but authorization is checked live
 * against Alfresco's own native SiteManager role instead of a stored
 * ownership table — see alfrescoAuthz.ts.
 */
export const alfrescoManagerPlugin = createBackendPlugin({
  pluginId: 'alfresco-manager',
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
        router.use(express.json());

        async function callerContext(req: Request): Promise<CallerInfo> {
          const credentials = await httpAuth.credentials(req);
          const info = await userInfo.getUserInfo(credentials);
          return {
            entityRef: info.userEntityRef,
            username: info.userEntityRef.split('/').pop() ?? info.userEntityRef,
            isAdmin: info.ownershipEntityRefs.includes(ADMIN_GROUP_REF),
          };
        }

        function forbidden(e: Error): boolean {
          return e.message.startsWith('Forbidden');
        }

        async function myRoleOnSite(siteId: string, username: string): Promise<string | undefined> {
          const res = await alfrescoFetch(config, `/sites/${encodeURIComponent(siteId)}/members/${encodeURIComponent(username)}`);
          if (!res.ok) return undefined;
          const body = (await res.json()) as { entry?: { role?: string } };
          return body.entry?.role;
        }

        // --- Sites ------------------------------------------------------

        router.get('/sites', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const listRes = await alfrescoFetch(config, '/sites?maxItems=1000');
            if (!listRes.ok) throw new Error(`${listRes.status} ${await listRes.text()}`);
            const body = (await listRes.json()) as {
              list: { entries: Array<{ entry: { id: string; title: string; description?: string; visibility: string } }> };
            };
            const all = body.list.entries.map(e => e.entry);

            const items: Array<{ id: string; title: string; description?: string; visibility: string; role?: string }> = [];
            for (const site of all) {
              const role = await myRoleOnSite(site.id, caller.username);
              if (caller.isAdmin || role) {
                items.push({ ...site, role });
              }
            }
            res.json({ items, isAdmin: caller.isAdmin });
          } catch (e) {
            logger.error('alfresco-manager GET /sites failed', e as Error);
            res.status(500).json({ error: (e as Error).message });
          }
        });

        router.delete('/sites/:id', async (req, res) => {
          try {
            const caller = await callerContext(req);
            await requireSiteManagerOrAdmin(config, caller, req.params.id);
            const delRes = await alfrescoFetch(config, `/sites/${encodeURIComponent(req.params.id)}`, { method: 'DELETE' });
            if (!delRes.ok) throw new Error(`${delRes.status} ${await delRes.text()}`);
            res.status(204).send();
          } catch (e) {
            logger.error('alfresco-manager DELETE /sites failed', e as Error);
            res.status(forbidden(e as Error) ? 403 : 500).json({ error: (e as Error).message });
          }
        });

        // --- Site members / roles ---------------------------------------

        router.get('/sites/:id/members', async (req, res) => {
          try {
            const caller = await callerContext(req);
            await requireSiteManagerOrAdmin(config, caller, req.params.id);
            const listRes = await alfrescoFetch(config, `/sites/${encodeURIComponent(req.params.id)}/members?maxItems=1000`);
            if (!listRes.ok) throw new Error(`${listRes.status} ${await listRes.text()}`);
            const body = (await listRes.json()) as { list: { entries: Array<{ entry: { id: string; role: string } }> } };
            res.json({ items: body.list.entries.map(e => ({ personId: e.entry.id, role: e.entry.role })) });
          } catch (e) {
            logger.error('alfresco-manager GET /sites/:id/members failed', e as Error);
            res.status(forbidden(e as Error) ? 403 : 500).json({ error: (e as Error).message });
          }
        });

        router.post('/sites/:id/members', async (req, res) => {
          try {
            const caller = await callerContext(req);
            await requireSiteManagerOrAdmin(config, caller, req.params.id);
            const personId = String(req.body?.personId ?? '');
            const role = String(req.body?.role ?? '');
            if (!personId || !isSiteRole(role)) {
              res.status(400).json({ error: 'personId and a valid role are required' });
              return;
            }
            const addRes = await alfrescoFetch(config, `/sites/${encodeURIComponent(req.params.id)}/members`, {
              method: 'POST',
              body: JSON.stringify({ id: personId, role }),
            });
            if (addRes.status === 409) {
              // Already a member -- promote/demote via PUT instead.
              const putRes = await alfrescoFetch(config, `/sites/${encodeURIComponent(req.params.id)}/members/${encodeURIComponent(personId)}`, {
                method: 'PUT',
                body: JSON.stringify({ role }),
              });
              if (!putRes.ok) throw new Error(`${putRes.status} ${await putRes.text()}`);
            } else if (!addRes.ok) {
              throw new Error(`${addRes.status} ${await addRes.text()}`);
            }
            res.status(204).send();
          } catch (e) {
            logger.error('alfresco-manager POST /sites/:id/members failed', e as Error);
            res.status(forbidden(e as Error) ? 403 : 500).json({ error: (e as Error).message });
          }
        });

        router.delete('/sites/:id/members/:personId', async (req, res) => {
          try {
            const caller = await callerContext(req);
            await requireSiteManagerOrAdmin(config, caller, req.params.id);
            const delRes = await alfrescoFetch(
              config,
              `/sites/${encodeURIComponent(req.params.id)}/members/${encodeURIComponent(req.params.personId)}`,
              { method: 'DELETE' },
            );
            if (!delRes.ok) throw new Error(`${delRes.status} ${await delRes.text()}`);
            res.status(204).send();
          } catch (e) {
            logger.error('alfresco-manager DELETE /sites/:id/members failed', e as Error);
            res.status(forbidden(e as Error) ? 403 : 500).json({ error: (e as Error).message });
          }
        });

        httpRouter.use(router);
        logger.info('alfresco-manager routes registered: /api/alfresco-manager/*');
      },
    });
  },
});
