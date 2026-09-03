import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { Request, Router } from 'express';
import {
  kcAdminFetch,
  ADMIN_GROUP_REF,
  ownerFromAttributes,
  ownerFromClientAttributes,
} from '../modules/actions/keycloak-actions';

interface KcUser {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  attributes?: Record<string, string[]>;
}

interface KcGroup {
  id: string;
  name: string;
  attributes?: Record<string, string[]>;
}

interface KcClient {
  clientId: string;
  name?: string;
  description?: string;
  publicClient?: boolean;
  attributes?: Record<string, string>;
}

/**
 * Backend for the /keycloak-manager frontend page: lists the Keycloak
 * users/groups/clients the caller owns (or everything, if they're a
 * backstage-admin member), so there's somewhere to browse what the
 * keycloak:create-, update-, delete- scaffolder actions have provisioned.
 * Read-only -- mutations still go through those existing actions, so
 * ownership enforcement stays in one place.
 */
export default createBackendPlugin({
  pluginId: 'keycloak-manager',
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

        async function callerContext(req: Request) {
          const credentials = await httpAuth.credentials(req);
          const info = await userInfo.getUserInfo(credentials);
          return {
            entityRef: info.userEntityRef,
            isAdmin: info.ownershipEntityRefs.includes(ADMIN_GROUP_REF),
          };
        }

        router.get('/users', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const users: KcUser[] = [];
            const pageSize = 100;
            for (let first = 0; ; first += pageSize) {
              const r = await kcAdminFetch(config, `/users?first=${first}&max=${pageSize}`);
              if (!r.ok) throw new Error(`Keycloak users list failed: ${r.status}`);
              const page = (await r.json()) as KcUser[];
              users.push(...page);
              if (page.length < pageSize) break;
            }
            const items = users
              .map(u => ({
                username: u.username,
                email: u.email,
                displayName: [u.firstName, u.lastName].filter(Boolean).join(' '),
                owner: ownerFromAttributes(u.attributes),
              }))
              .filter(u => caller.isAdmin || u.owner === caller.entityRef);
            res.json({ items, isAdmin: caller.isAdmin });
          } catch (e) {
            logger.error('keycloak-manager /users failed', e as Error);
            res.status(500).json({ error: (e as Error).message });
          }
        });

        router.get('/groups', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const roots = (await (
              await kcAdminFetch(config, '/groups?briefRepresentation=false')
            ).json()) as KcGroup[];
            const all: KcGroup[] = [];
            const walk = async (group: KcGroup) => {
              all.push(group);
              const childrenRes = await kcAdminFetch(
                config,
                `/groups/${group.id}/children?briefRepresentation=false`,
              );
              if (!childrenRes.ok) return;
              const children = (await childrenRes.json()) as KcGroup[];
              for (const child of children) {
                await walk(child);
              }
            };
            for (const root of roots) {
              await walk(root);
            }
            const items = all
              .map(g => ({
                name: g.name,
                owner: ownerFromAttributes(g.attributes),
              }))
              .filter(g => caller.isAdmin || g.owner === caller.entityRef);
            res.json({ items, isAdmin: caller.isAdmin });
          } catch (e) {
            logger.error('keycloak-manager /groups failed', e as Error);
            res.status(500).json({ error: (e as Error).message });
          }
        });

        router.get('/clients', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const r = await kcAdminFetch(config, '/clients');
            if (!r.ok) throw new Error(`Keycloak clients list failed: ${r.status}`);
            const clients = (await r.json()) as KcClient[];
            const items = clients
              .map(c => ({
                clientId: c.clientId,
                name: c.name,
                publicClient: c.publicClient,
                owner: ownerFromClientAttributes(c.attributes),
              }))
              .filter(c => caller.isAdmin || c.owner === caller.entityRef);
            res.json({ items, isAdmin: caller.isAdmin });
          } catch (e) {
            logger.error('keycloak-manager /clients failed', e as Error);
            res.status(500).json({ error: (e as Error).message });
          }
        });

        httpRouter.use(router);
        logger.info('keycloak-manager routes registered: /api/keycloak-manager/*');
      },
    });
  },
});
