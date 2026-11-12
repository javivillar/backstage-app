import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { json, Request, Router } from 'express';
import {
  kcAdminFetch,
  COMPONENT,
  ownerFromAttributes,
  ownerFromClientAttributes,
} from './actions';
import { securityOf, unowned } from './security';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { accessRouter } from './accessRoutes';
import { AccessRequestStore, ensureRequestsTable } from './accessRequests';
import { AccessStore, ensureTable } from './accessStore';
import { groupNames } from './accessModel';
import { administersProduct, permissionsOf, rolesOf } from '@internal/backstage-plugin-portal-access-common';

interface KcUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  attributes?: Record<string, string[]>;
}

interface KcGroup {
  id: string;
  name: string;
  path?: string;
  attributes?: Record<string, string[]>;
}

interface KcClient {
  id: string;
  clientId: string;
  name?: string;
  description?: string;
  publicClient?: boolean;
  serviceAccountsEnabled?: boolean;
  redirectUris?: string[];
  webOrigins?: string[];
  attributes?: Record<string, string>;
}

/**
 * Where an object of Keycloak is declared, for Manage (every change is a pull request on that file): an application
 * (attribute refresquito.component, set by the provisioner of its sso block), the platform (refresquito.managed:
 * platform, set by the reconciler of iam-oneke from bootstrap/app-of-apps/platform/iam.yaml), or nowhere (made by hand
 * or by the old direct-write actions: Manage cannot change it until it is declared).
 */
export type Declared = { kind: 'application'; name: string; stage?: string } | { kind: 'platform' } | undefined;
const firstOf = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
export function declaredBy(attributes?: Record<string, string | string[]>): Declared {
  if (firstOf(attributes?.['refresquito.managed']) === 'platform') return { kind: 'platform' };
  const component = firstOf(attributes?.['refresquito.component']);
  if (component && component !== 'platform') return { kind: 'application', name: component, stage: firstOf(attributes?.['refresquito.stage']) };
  return undefined;
}

/**
 * Backend for the /keycloak-manager frontend page: lists the Keycloak
 * users/groups/clients the caller owns (or everything, if they're a
 * backstage-admin member), so there's somewhere to browse what the
 * keycloak:create-, update-, delete- scaffolder actions have provisioned.
 * Read-only -- mutations still go through those existing actions, so
 * ownership enforcement stays in one place.
 */
export const keycloakManagerPlugin = createBackendPlugin({
  pluginId: 'keycloak-manager',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        userInfo: coreServices.userInfo,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        database: coreServices.database,
        catalog: catalogServiceRef,
      },
      async init({ httpRouter, httpAuth, userInfo, config, logger, database, catalog }) {
        const router = Router();

        // access administration (accessRoutes.ts): without its database nothing is changed, since no change could
        // be recorded; the pages still read
        let store: AccessStore | undefined;
        let requests: AccessRequestStore | undefined;
        try {
          const knex = await database.getClient();
          await ensureTable(knex);
          store = new AccessStore(knex);
          await ensureRequestsTable(knex);
          requests = new AccessRequestStore(knex);
        } catch (e) {
          logger.warn(`keycloak-manager: access changes cannot be recorded, so none will be made: ${(e as Error).message}`);
        }
        router.use(
          '/access',
          json({ limit: '10kb' }),
          accessRouter({
            config,
            logger,
            catalog,
            store,
            requests,
            caller: async req => {
              const credentials = await httpAuth.credentials(req);
              const info = await userInfo.getUserInfo(credentials);
              return { credentials, entityRef: info.userEntityRef, ownershipEntityRefs: info.ownershipEntityRefs };
            },
          }),
        );

        async function callerContext(req: Request) {
          const credentials = await httpAuth.credentials(req);
          const info = await userInfo.getUserInfo(credentials);
          return {
            entityRef: info.userEntityRef,
            isAdmin: administersProduct(COMPONENT, info.ownershipEntityRefs),
          };
        }

        // what the signed-in person may do in the portal (portal-access-common permissions.ts): the console hides the rest
        router.get('/permissions', async (req, res) => {
          try {
            const info = await userInfo.getUserInfo(await httpAuth.credentials(req));
            res.json(permissionsOf(rolesOf(groupNames(info.ownershipEntityRefs))));
          } catch (e) {
            logger.error('keycloak-manager /permissions failed', e as Error);
            res.status(500).json({ error: (e as Error).message });
          }
        });

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
                // the id opens it in the Keycloak admin console (console › Manage › IAM)
                id: u.id,
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
                id: g.id,
                name: g.name,
                path: g.path,
                description: g.attributes?.description?.[0],
                grants: g.attributes?.['refresquito.grants']?.[0],
                declared: declaredBy(g.attributes),
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
                id: c.id,
                clientId: c.clientId,
                name: c.name,
                description: c.description,
                publicClient: c.publicClient,
                serviceAccount: c.serviceAccountsEnabled === true,
                redirectUris: c.redirectUris ?? [],
                declared: declaredBy(c.attributes),
                owner: ownerFromClientAttributes(c.attributes),
              }))
              .filter(c => caller.isAdmin || c.owner === caller.entityRef);
            res.json({ items, isAdmin: caller.isAdmin });
          } catch (e) {
            logger.error('keycloak-manager /clients failed', e as Error);
            res.status(500).json({ error: (e as Error).message });
          }
        });

        // the Security tab of a Component: ?component=<name>[&stage=<stage>]. Every signed-in user sees which groups,
        // clients and roles govern a component, and how many people each group has; only backstage-admin sees who.
        router.get('/security', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const component = String(req.query.component ?? '').trim();
            const stage = String(req.query.stage ?? '').trim() || undefined;
            if (!component) {
              res.status(400).json({ error: 'component is required' });
              return;
            }
            res.json({ ...(await securityOf(config, component, stage, caller.isAdmin)), isAdmin: caller.isAdmin });
          } catch (e) {
            logger.error('keycloak-manager /security failed', e as Error);
            res.status(500).json({ error: (e as Error).message });
          }
        });

        // groups, clients and realm roles that belong to no component (backstage-admin only)
        router.get('/security/unowned', async (req, res) => {
          try {
            const caller = await callerContext(req);
            if (!caller.isAdmin) {
              res.status(403).json({ error: 'only backstage-admin' });
              return;
            }
            res.json(await unowned(config));
          } catch (e) {
            logger.error('keycloak-manager /security/unowned failed', e as Error);
            res.status(500).json({ error: (e as Error).message });
          }
        });

        httpRouter.use(router);
        logger.info('keycloak-manager routes registered: /api/keycloak-manager/*');
      },
    });
  },
});
