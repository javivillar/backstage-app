import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import express, { Request, Router } from 'express';
import {
  GraviteeError,
  consoleApiUrl,
  gatewayPathPrefix,
  gatewayUrl,
  graviteePublicUrl,
  graviteeSettings,
  isGraviteeConfigured,
} from './graviteeClient';
import { GvApi, backendUrlOf, contextPathOf, createOwnedApi, ensureGraviteeUser, getTeam, listAllApis } from './graviteeApis';
import { Access, Caller, accessTo, canEdit, resolveCaller } from './graviteeAuthz';

/**
 * Backend for the /gravitee-manager page ("soft" self-service of Gravitee
 * gateways = v4 HTTP proxy APIs):
 *
 *   GET  /apis   the caller's own APIs + their team's (read-only) + all for admins
 *   POST /apis   create one: PRIVATE, STOPPED, no plans; the caller becomes its
 *                Gravitee PRIMARY_OWNER, tagged with one of their teams
 *
 * No scaffolder actions on purpose: scaffolder task parameters are visible to
 * every Backstage user while the permission policy is allow-all
 * (refresquito-services#40). Nothing is written to the Backstage catalog.
 * Authorization: graviteeAuthz.ts, deny by default.
 */

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,49}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

interface ApiRow {
  id: string;
  name: string;
  version: string;
  description?: string;
  contextPath?: string;
  gatewayUrl?: string;
  backendUrl?: string;
  state?: string;
  visibility?: string;
  lifecycleState?: string;
  deploymentState?: string;
  team?: string;
  owner?: string;
  access: Access;
  canEdit: boolean;
  consoleUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Runs fn over items with at most `limit` in flight (metadata is one call per API). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export const graviteeManagerPlugin = createBackendPlugin({
  pluginId: 'gravitee-manager',
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

        router.use((_req, res, next) => {
          if (!isGraviteeConfigured(config)) {
            res.status(503).json({ error: 'The Gravitee integration is not configured (graviteeAdmin.*)' });
            return;
          }
          next();
        });

        async function caller(req: Request): Promise<Caller> {
          const info = await userInfo.getUserInfo(await httpAuth.credentials(req));
          return resolveCaller(config, info.userEntityRef, info.ownershipEntityRefs);
        }

        function fail(res: express.Response, what: string, e: Error) {
          logger.error(`gravitee-manager ${what} failed`, e);
          const status = e instanceof GraviteeError && e.status >= 400 && e.status < 500 ? e.status : 500;
          res.status(status).json({ error: e.message });
        }

        function toRow(api: GvApi, team: string | undefined, access: Access): ApiRow {
          const contextPath = contextPathOf(api);
          const editable = canEdit(access);
          return {
            id: api.id,
            name: api.name,
            version: api.apiVersion,
            description: api.description,
            contextPath,
            gatewayUrl: contextPath ? gatewayUrl(config, contextPath) : undefined,
            backendUrl: backendUrlOf(api),
            state: api.state,
            visibility: api.visibility,
            lifecycleState: api.lifecycleState,
            deploymentState: api.deploymentState,
            team,
            owner: api.primaryOwner?.displayName ?? api.primaryOwner?.email,
            access,
            canEdit: editable,
            // A teammate would only get a 403 in the Console, so no link for them.
            consoleUrl: editable ? consoleApiUrl(config, api.id) : undefined,
            createdAt: api.createdAt,
            updatedAt: api.updatedAt,
          };
        }

        router.get('/apis', async (req, res) => {
          try {
            const c = await caller(req);
            const apis = await listAllApis(config);
            const rows = await mapLimit(apis, 8, async api => {
              const team = await getTeam(config, api.id);
              const access = accessTo(c, api, team);
              return access ? toRow(api, team, access) : undefined;
            });
            res.json({
              items: rows.filter((r): r is ApiRow => r !== undefined).sort((a, b) => a.name.localeCompare(b.name)),
              teams: c.teams,
              isAdmin: c.isAdmin,
              canCreate: c.teams.length > 0,
              gatewayPathPrefix: gatewayPathPrefix(config),
              publicUrl: graviteePublicUrl(config),
            });
          } catch (e) {
            fail(res, 'GET /apis', e as Error);
          }
        });

        router.post('/apis', async (req, res) => {
          try {
            const c = await caller(req);
            const body = req.body ?? {};
            const name = String(body.name ?? '').trim();
            const version = String(body.version ?? '1.0').trim();
            const description = String(body.description ?? '').trim();
            const slug = String(body.slug ?? '').trim();
            const backendUrl = String(body.backendUrl ?? '').trim();
            const team = String(body.team ?? (c.teams.length === 1 ? c.teams[0] : '')).trim();

            const problems: string[] = [];
            if (!NAME_RE.test(name)) problems.push('name: 1-50 letters, digits, spaces, "_", "." or "-"');
            if (!VERSION_RE.test(version)) problems.push('version: 1-20 letters, digits, ".", "_" or "-"');
            if (description.length > 500) problems.push('description: at most 500 characters');
            if (!SLUG_RE.test(slug)) problems.push('path: 1-50 lowercase letters, digits or "-" (no leading/trailing "-")');
            try {
              const u = new URL(backendUrl);
              if (u.protocol !== 'http:' && u.protocol !== 'https:') problems.push('backendUrl: must be http(s)');
            } catch {
              problems.push('backendUrl: not a valid URL');
            }
            if (problems.length) {
              res.status(400).json({ error: problems.join('; ') });
              return;
            }
            if (!c.teams.includes(team)) {
              res.status(403).json({
                error: c.teams.length
                  ? `You can only create gateways for one of your teams: ${c.teams.join(', ')}`
                  : 'You are not in any gravitee-team-* group, so you cannot create gateways',
              });
              return;
            }

            const ownerId =
              c.graviteeUserId ?? (await ensureGraviteeUser(config, c.person, graviteeSettings(config).identityProvider));
            const api = await createOwnedApi(
              config,
              {
                name,
                version,
                description,
                contextPath: `${gatewayPathPrefix(config)}/${slug}/`,
                backendUrl,
                team,
              },
              ownerId,
            );
            logger.info(`gravitee-manager: ${c.username} created API ${api.id} (${name}) for ${team}`);
            res.status(201).json(toRow(api, team, 'owner'));
          } catch (e) {
            fail(res, 'POST /apis', e as Error);
          }
        });

        httpRouter.use(router);
      },
    });
  },
});
