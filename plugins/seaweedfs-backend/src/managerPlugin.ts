import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import express, { Request, Router } from 'express';
import { seaweedfsAdminFetch } from './seaweedfsClient';
import { ADMIN_GROUP_REF, CallerInfo, ensureOwnershipTable, forgetOwnership, ownerOf, ownershipMap } from './ownership';

/**
 * Backend for the /seaweedfs-manager frontend page: lists the SeaweedFS
 * buckets/table buckets/groups/policies the caller owns (or everything, if
 * they're a backstage-admin member), and backs delete + the group-edit
 * policy-attach/detach actions. Same shape as superset-manager/
 * camunda-manager.
 */
export const seaweedfsManagerPlugin = createBackendPlugin({
  pluginId: 'seaweedfs-manager',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        userInfo: coreServices.userInfo,
        config: coreServices.rootConfig,
        database: coreServices.database,
        logger: coreServices.logger,
      },
      async init({ httpRouter, httpAuth, userInfo, config, database, logger }) {
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

        // --- Buckets ------------------------------------------------------

        router.get('/buckets', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const listRes = await seaweedfsAdminFetch(config, '/api/s3/buckets');
            if (!listRes.ok) throw new Error(`${listRes.status} ${await listRes.text()}`);
            const body = (await listRes.json()) as { buckets?: Array<{ name: string; owner?: string; versioning_status?: string; logical_size?: number }> };
            const all = body.buckets ?? [];
            const items = caller.isAdmin ? all : all.filter(b => b.owner === caller.username);
            res.json({ items: items.map(b => ({ name: b.name, owner: b.owner, versioningStatus: b.versioning_status, size: b.logical_size })), isAdmin: caller.isAdmin });
          } catch (e) {
            logger.error('seaweedfs-manager GET /buckets failed', e as Error);
            res.status(500).json({ error: (e as Error).message });
          }
        });

        router.delete('/buckets/:name', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const getRes = await seaweedfsAdminFetch(config, `/api/s3/buckets/${encodeURIComponent(req.params.name)}`);
            if (!getRes.ok) {
              res.status(404).json({ error: `Bucket "${req.params.name}" not found` });
              return;
            }
            const detail = (await getRes.json()) as { bucket?: { owner?: string } };
            if (!caller.isAdmin && detail.bucket?.owner !== caller.username) {
              throw new Error(`Forbidden: ${caller.entityRef} may not delete bucket "${req.params.name}"`);
            }
            const delRes = await seaweedfsAdminFetch(config, `/api/s3/buckets/${encodeURIComponent(req.params.name)}`, { method: 'DELETE' });
            if (!delRes.ok) throw new Error(`${delRes.status} ${await delRes.text()}`);
            res.status(204).send();
          } catch (e) {
            logger.error('seaweedfs-manager DELETE /buckets failed', e as Error);
            res.status(forbidden(e as Error) ? 403 : 500).json({ error: (e as Error).message });
          }
        });

        // --- Table buckets --------------------------------------------------

        router.get('/table-buckets', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const listRes = await seaweedfsAdminFetch(config, '/api/s3tables/buckets');
            if (!listRes.ok) throw new Error(`${listRes.status} ${await listRes.text()}`);
            const body = (await listRes.json()) as { buckets?: Array<{ name: string; arn: string; ownerAccountId?: string }> };
            const all = body.buckets ?? [];
            const items = caller.isAdmin ? all : all.filter(b => b.ownerAccountId === caller.username);
            res.json({ items: items.map(b => ({ name: b.name, arn: b.arn, owner: b.ownerAccountId })), isAdmin: caller.isAdmin });
          } catch (e) {
            logger.error('seaweedfs-manager GET /table-buckets failed', e as Error);
            res.status(500).json({ error: (e as Error).message });
          }
        });

        router.delete('/table-buckets', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const arn = String(req.query.arn ?? '');
            const listRes = await seaweedfsAdminFetch(config, '/api/s3tables/buckets');
            if (!listRes.ok) throw new Error(`${listRes.status} ${await listRes.text()}`);
            const list = (await listRes.json()) as { buckets?: Array<{ arn: string; name: string; ownerAccountId?: string }> };
            const found = list.buckets?.find(b => b.arn === arn);
            if (!found) {
              res.status(404).json({ error: `Table bucket with ARN "${arn}" not found` });
              return;
            }
            if (!caller.isAdmin && found.ownerAccountId !== caller.username) {
              throw new Error(`Forbidden: ${caller.entityRef} may not delete table bucket "${found.name}"`);
            }
            const delRes = await seaweedfsAdminFetch(config, `/api/s3tables/buckets?bucket=${encodeURIComponent(arn)}`, { method: 'DELETE' });
            if (!delRes.ok) throw new Error(`${delRes.status} ${await delRes.text()}`);
            res.status(204).send();
          } catch (e) {
            logger.error('seaweedfs-manager DELETE /table-buckets failed', e as Error);
            res.status(forbidden(e as Error) ? 403 : 500).json({ error: (e as Error).message });
          }
        });

        // --- Groups ---------------------------------------------------------

        router.get('/groups', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const knex = await ensureOwnershipTable(database);
            const owners = await ownershipMap(knex, 'group');
            const listRes = await seaweedfsAdminFetch(config, '/api/groups');
            if (!listRes.ok) throw new Error(`${listRes.status} ${await listRes.text()}`);
            const body = (await listRes.json()) as { groups?: Array<{ name: string; member_count: number; policy_names: string[]; status: string }> };
            const all = body.groups ?? [];
            const items = caller.isAdmin ? all : all.filter(g => owners[g.name] === caller.username);
            res.json({
              items: items.map(g => ({ name: g.name, memberCount: g.member_count, policyNames: g.policy_names, status: g.status, owner: owners[g.name] })),
              isAdmin: caller.isAdmin,
            });
          } catch (e) {
            logger.error('seaweedfs-manager GET /groups failed', e as Error);
            res.status(500).json({ error: (e as Error).message });
          }
        });

        router.delete('/groups/:name', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const knex = await ensureOwnershipTable(database);
            const owner = await ownerOf(knex, 'group', req.params.name);
            if (!caller.isAdmin && owner !== caller.username) {
              throw new Error(`Forbidden: ${caller.entityRef} may not delete group "${req.params.name}"`);
            }
            const delRes = await seaweedfsAdminFetch(config, `/api/groups/${encodeURIComponent(req.params.name)}`, { method: 'DELETE' });
            if (!delRes.ok) throw new Error(`${delRes.status} ${await delRes.text()}`);
            await forgetOwnership(knex, 'group', req.params.name);
            res.status(204).send();
          } catch (e) {
            logger.error('seaweedfs-manager DELETE /groups failed', e as Error);
            res.status(forbidden(e as Error) ? 403 : 500).json({ error: (e as Error).message });
          }
        });

        // Attach/detach a policy on a group the caller owns. The picker on
        // the frontend already only offers the caller's own policies (via
        // GET /policies, same ownership filter as the Policies tab) — this
        // re-checks both group AND policy ownership server-side too, since
        // client-side filtering alone is never a real access control.
        router.post('/groups/:name/policies', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const policyName = String(req.body?.policy_name ?? '');
            if (!policyName) {
              res.status(400).json({ error: 'policy_name is required' });
              return;
            }
            const knex = await ensureOwnershipTable(database);
            const groupOwner = await ownerOf(knex, 'group', req.params.name);
            if (!caller.isAdmin && groupOwner !== caller.username) {
              throw new Error(`Forbidden: ${caller.entityRef} may not edit group "${req.params.name}"`);
            }
            const policyOwner = await ownerOf(knex, 'policy', policyName);
            if (!caller.isAdmin && policyOwner !== caller.username) {
              throw new Error(`Forbidden: ${caller.entityRef} may not attach policy "${policyName}" (not its owner)`);
            }
            const attachRes = await seaweedfsAdminFetch(config, `/api/groups/${encodeURIComponent(req.params.name)}/policies`, {
              method: 'POST',
              body: JSON.stringify({ policy_name: policyName }),
            });
            if (!attachRes.ok) throw new Error(`${attachRes.status} ${await attachRes.text()}`);
            res.status(204).send();
          } catch (e) {
            logger.error('seaweedfs-manager POST /groups/:name/policies failed', e as Error);
            res.status(forbidden(e as Error) ? 403 : 500).json({ error: (e as Error).message });
          }
        });

        router.delete('/groups/:name/policies/:policyName', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const knex = await ensureOwnershipTable(database);
            const groupOwner = await ownerOf(knex, 'group', req.params.name);
            if (!caller.isAdmin && groupOwner !== caller.username) {
              throw new Error(`Forbidden: ${caller.entityRef} may not edit group "${req.params.name}"`);
            }
            const detachRes = await seaweedfsAdminFetch(
              config,
              `/api/groups/${encodeURIComponent(req.params.name)}/policies/${encodeURIComponent(req.params.policyName)}`,
              { method: 'DELETE' },
            );
            if (!detachRes.ok) throw new Error(`${detachRes.status} ${await detachRes.text()}`);
            res.status(204).send();
          } catch (e) {
            logger.error('seaweedfs-manager DELETE /groups/:name/policies failed', e as Error);
            res.status(forbidden(e as Error) ? 403 : 500).json({ error: (e as Error).message });
          }
        });

        // --- Policies ---------------------------------------------------------
        // Also backs the group-edit policy picker on the frontend — same
        // ownership-scoped list either way (that's the whole point).

        router.get('/policies', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const knex = await ensureOwnershipTable(database);
            const owners = await ownershipMap(knex, 'policy');
            const listRes = await seaweedfsAdminFetch(config, '/api/object-store/policies');
            if (!listRes.ok) throw new Error(`${listRes.status} ${await listRes.text()}`);
            const body = (await listRes.json()) as { policies?: Array<{ name: string }> } | Array<{ name: string }>;
            const all = Array.isArray(body) ? body : body.policies ?? [];
            const items = caller.isAdmin ? all : all.filter(p => owners[p.name] === caller.username);
            res.json({ items: items.map(p => ({ name: p.name, owner: owners[p.name] })), isAdmin: caller.isAdmin });
          } catch (e) {
            logger.error('seaweedfs-manager GET /policies failed', e as Error);
            res.status(500).json({ error: (e as Error).message });
          }
        });

        router.delete('/policies/:name', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const knex = await ensureOwnershipTable(database);
            const owner = await ownerOf(knex, 'policy', req.params.name);
            if (!caller.isAdmin && owner !== caller.username) {
              throw new Error(`Forbidden: ${caller.entityRef} may not delete policy "${req.params.name}"`);
            }
            const delRes = await seaweedfsAdminFetch(config, `/api/object-store/policies/${encodeURIComponent(req.params.name)}`, { method: 'DELETE' });
            if (!delRes.ok) throw new Error(`${delRes.status} ${await delRes.text()}`);
            await forgetOwnership(knex, 'policy', req.params.name);
            res.status(204).send();
          } catch (e) {
            logger.error('seaweedfs-manager DELETE /policies failed', e as Error);
            res.status(forbidden(e as Error) ? 403 : 500).json({ error: (e as Error).message });
          }
        });

        httpRouter.use(router);
        logger.info('seaweedfs-manager routes registered: /api/seaweedfs-manager/*');
      },
    });
  },
});
