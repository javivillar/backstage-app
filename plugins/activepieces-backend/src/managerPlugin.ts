import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import express, { Request, Router } from 'express';
import { apFetch, apJson, apListAll, activepiecesPublicUrl, flowUrl, projectUrl } from './activepiecesClient';
import {
  ADMIN_GROUP_REF,
  ApMember,
  CallerInfo,
  PERM_WRITE_PROJECT,
  PERM_WRITE_PROJECT_MEMBER,
  findUserByEmail,
  isForbidden,
  ownerOf,
  listManagedProjects,
  listMembers,
  requireProjectPermission,
  usernameFromEntityRef,
} from './activepiecesAuthz';
import { addOrSetMember, listRoles, removeMember } from './activepiecesProjects';
import {
  PERM_READ_FLOW,
  PERM_WRITE_FLOW,
  createFlow,
  deleteFlow,
  flowName,
  folderNames,
  listFlows,
  renameFlow,
  requireFlowInProject,
} from './activepiecesFlows';
import { ensureAccessGroup, getKeycloakPerson } from './keycloakLookup';

/**
 * Backend for the /activepieces-manager page: lists the Backstage-managed
 * Activepieces projects the caller is a member of (all of them, for a
 * backstage-admin), and backs rename/delete plus the per-project members
 * dialog. Project CREATION goes through the scaffolder template, like the
 * other manager plugins. Every route goes through requireProjectPermission()
 * -- see activepiecesAuthz.ts -- because the API key used underneath is
 * platform-wide and Activepieces would not stop a cross-user request.
 */
export const activepiecesManagerPlugin = createBackendPlugin({
  pluginId: 'activepieces-manager',
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
          const info = await userInfo.getUserInfo(await httpAuth.credentials(req));
          return {
            entityRef: info.userEntityRef,
            username: usernameFromEntityRef(info.userEntityRef),
            isAdmin: info.ownershipEntityRefs.includes(ADMIN_GROUP_REF),
          };
        }

        function fail(res: express.Response, what: string, e: Error) {
          logger.error(`activepieces-manager ${what} failed`, e);
          res.status(isForbidden(e) ? 403 : 500).json({ error: e.message });
        }

        // --- Projects ---------------------------------------------------

        router.get('/projects', async (req, res) => {
          try {
            const caller = await callerContext(req);
            const myEmail = (await getKeycloakPerson(config, caller.username)).email.toLowerCase();
            // Creator with no Activepieces account yet: see isPendingOwner().
            const hasAccount = (await findUserByEmail(config, myEmail)) !== undefined;
            const items = [];
            for (const project of await listManagedProjects(config)) {
              const members = await listMembers(config, project.id);
              const mine = members.find(m => m.user.email.toLowerCase() === myEmail);
              const pendingOwner = !mine && !hasAccount && ownerOf(project) === caller.username;
              if (!mine && !pendingOwner && !caller.isAdmin) continue;
              items.push({
                id: project.id,
                displayName: project.displayName,
                owner: ownerOf(project),
                created: project.created,
                role: mine?.projectRole.name ?? (pendingOwner ? 'Admin (until first Activepieces login)' : undefined),
                canManage: caller.isAdmin || pendingOwner || !!mine?.projectRole.permissions.includes(PERM_WRITE_PROJECT),
                canManageMembers:
                  caller.isAdmin || pendingOwner || !!mine?.projectRole.permissions.includes(PERM_WRITE_PROJECT_MEMBER),
                canReadFlows: caller.isAdmin || pendingOwner || !!mine?.projectRole.permissions.includes(PERM_READ_FLOW),
                canWriteFlows: caller.isAdmin || pendingOwner || !!mine?.projectRole.permissions.includes(PERM_WRITE_FLOW),
                url: projectUrl(config, project.id),
              });
            }
            res.json({ items, isAdmin: caller.isAdmin, publicUrl: activepiecesPublicUrl(config) });
          } catch (e) {
            fail(res, 'GET /projects', e as Error);
          }
        });

        router.post('/projects/:id', async (req, res) => {
          try {
            const caller = await callerContext(req);
            await requireProjectPermission(config, caller, req.params.id, PERM_WRITE_PROJECT);
            const name = String(req.body?.displayName ?? '').trim();
            if (!name) {
              res.status(400).json({ error: 'displayName is required' });
              return;
            }
            await apJson(config, `/v1/projects/${encodeURIComponent(req.params.id)}`, {
              method: 'POST',
              body: JSON.stringify({ displayName: name }),
            });
            res.status(204).send();
          } catch (e) {
            fail(res, 'POST /projects/:id', e as Error);
          }
        });

        router.delete('/projects/:id', async (req, res) => {
          try {
            const caller = await callerContext(req);
            await requireProjectPermission(config, caller, req.params.id, PERM_WRITE_PROJECT);
            const del = await apFetch(config, `/v1/projects/${encodeURIComponent(req.params.id)}`, { method: 'DELETE' });
            if (!del.ok) throw new Error(`${del.status} ${await del.text()}`);
            res.status(204).send();
          } catch (e) {
            fail(res, 'DELETE /projects/:id', e as Error);
          }
        });

        // --- Flows -------------------------------------------------------
        // Backstage only creates/renames/deletes EMPTY flows; they are modelled
        // and published in Activepieces. Access follows the caller's own
        // Activepieces role in the project (READ_FLOW / WRITE_FLOW).

        router.get('/projects/:id/flows', async (req, res) => {
          try {
            const caller = await callerContext(req);
            await requireProjectPermission(config, caller, req.params.id, PERM_READ_FLOW);
            const [flows, folders] = await Promise.all([
              listFlows(config, req.params.id),
              folderNames(config, req.params.id),
            ]);
            res.json({
              items: flows.map(f => ({
                id: f.id,
                displayName: flowName(f),
                folder: f.folderId ? folders.get(f.folderId) : undefined,
                status: f.status,
                updated: f.updated,
                url: flowUrl(config, req.params.id, f.id),
              })),
            });
          } catch (e) {
            fail(res, 'GET /projects/:id/flows', e as Error);
          }
        });

        router.post('/projects/:id/flows', async (req, res) => {
          try {
            const caller = await callerContext(req);
            await requireProjectPermission(config, caller, req.params.id, PERM_WRITE_FLOW);
            const name = String(req.body?.displayName ?? '').trim();
            if (!name) {
              res.status(400).json({ error: 'displayName is required' });
              return;
            }
            const folder = String(req.body?.folder ?? '').trim() || undefined;
            const flow = await createFlow(config, req.params.id, name, folder);
            res.status(201).json({ id: flow.id, url: flowUrl(config, req.params.id, flow.id) });
          } catch (e) {
            fail(res, 'POST /projects/:id/flows', e as Error);
          }
        });

        router.post('/projects/:id/flows/:flowId', async (req, res) => {
          try {
            const caller = await callerContext(req);
            await requireFlowInProject(config, caller, req.params.id, req.params.flowId, PERM_WRITE_FLOW);
            const name = String(req.body?.displayName ?? '').trim();
            if (!name) {
              res.status(400).json({ error: 'displayName is required' });
              return;
            }
            await renameFlow(config, req.params.id, req.params.flowId, name);
            res.status(204).send();
          } catch (e) {
            fail(res, 'POST /projects/:id/flows/:flowId', e as Error);
          }
        });

        router.delete('/projects/:id/flows/:flowId', async (req, res) => {
          try {
            const caller = await callerContext(req);
            await requireFlowInProject(config, caller, req.params.id, req.params.flowId, PERM_WRITE_FLOW);
            await deleteFlow(config, req.params.id, req.params.flowId);
            res.status(204).send();
          } catch (e) {
            fail(res, 'DELETE /projects/:id/flows/:flowId', e as Error);
          }
        });

        // --- Roles (for the dropdown) ------------------------------------

        router.get('/roles', async (req, res) => {
          try {
            await callerContext(req);
            res.json({ items: (await listRoles(config)).map(r => r.name) });
          } catch (e) {
            fail(res, 'GET /roles', e as Error);
          }
        });

        // --- Members -----------------------------------------------------

        router.get('/projects/:id/members', async (req, res) => {
          try {
            const caller = await callerContext(req);
            await requireProjectPermission(config, caller, req.params.id, PERM_WRITE_PROJECT_MEMBER);
            const members = await listMembers(config, req.params.id);
            // Accepted invitations whose user has not logged in yet: the
            // membership only materialises at their first Keycloak login.
            let pending: Array<{ email: string; role?: string }> = [];
            try {
              const invitations = await apListAll<{ email: string; status: string; projectRoleId: string | null }>(
                config,
                `/v1/user-invitations?type=PROJECT&projectId=${encodeURIComponent(req.params.id)}&status=ACCEPTED`,
              );
              const joined = new Set(members.map((m: ApMember) => m.user.email.toLowerCase()));
              pending = invitations.filter(i => !joined.has(i.email.toLowerCase())).map(i => ({ email: i.email }));
            } catch (e) {
              logger.warn(`activepieces-manager could not list pending invitations: ${(e as Error).message}`);
            }
            res.json({
              items: members.map(m => ({
                memberId: m.id,
                email: m.user.email,
                name: [m.user.firstName, m.user.lastName].filter(Boolean).join(' '),
                role: m.projectRole.name,
              })),
              pending,
            });
          } catch (e) {
            fail(res, 'GET /projects/:id/members', e as Error);
          }
        });

        router.post('/projects/:id/members', async (req, res) => {
          try {
            const caller = await callerContext(req);
            await requireProjectPermission(config, caller, req.params.id, PERM_WRITE_PROJECT_MEMBER);
            const username = String(req.body?.username ?? '').trim();
            const role = String(req.body?.role ?? '').trim();
            if (!username || !role) {
              res.status(400).json({ error: 'username and role are required' });
              return;
            }
            const person = await getKeycloakPerson(config, username);
            await ensureAccessGroup(config, person);
            const result = await addOrSetMember(config, req.params.id, person.email, role);
            res.json(result);
          } catch (e) {
            fail(res, 'POST /projects/:id/members', e as Error);
          }
        });

        router.delete('/projects/:id/members/:memberId', async (req, res) => {
          try {
            const caller = await callerContext(req);
            await requireProjectPermission(config, caller, req.params.id, PERM_WRITE_PROJECT_MEMBER);
            await removeMember(config, req.params.id, req.params.memberId);
            res.status(204).send();
          } catch (e) {
            fail(res, 'DELETE /projects/:id/members/:memberId', e as Error);
          }
        });

        httpRouter.use(router);
        logger.info('activepieces-manager routes registered: /api/activepieces-manager/*');
      },
    });
  },
});
