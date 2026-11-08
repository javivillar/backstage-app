import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import express, { Router } from 'express';
import { mayAct, ownsEntity } from './clusterActions';
import { GitHubFiles, PR_PREFIX } from './clusterVms';
// the kinds of object of IAM, API management, Data management and Business intelligence (each file registers its own)
import './manageHandlersIam';
import './manageHandlersGravitee';
import './manageHandlersDatahub';
import './manageHandlersSuperset';
import './manageHandlersProcesses';
import { applyChange, ChangeError, type ChangeRequest, handlerFor, handlers, lineDiff, type ManageAction, NAME, type Owner, parse } from './manageModel';

/**
 * Manage through git (refresquito-services MANAGE-GITOPS-DESIGN.md): the console's Manage pages change the objects of
 * the platform services by pull request, never by writing to the product.
 *
 *   GET  /api/manage/owners            [{ kind, name, title, owner, canWrite }]: the business applications (and the
 *        platform) whose objects the person may change; for the application picker of the forms
 *   POST /api/manage/changes           { service, object, action, owner, id?, spec?, reason?, dryRun? } →
 *        { pull?: { number, url }, file, diff, summary }: edits the file that declares the object (the application's
 *        file of the app-of-apps) and opens the pull request; dryRun only answers the diff
 *   GET  /api/manage/pending[?service=] [{ number, title, url, service, object, id, owner }]: the open pull requests
 *        of Manage, so the pages show "pending change #n" on an object
 *   GET  /api/manage/handlers          [{ service, object, label }]: what Manage can change today
 *   GET  /api/manage/declared?service=&object=  [{ owner, id, spec, gone }]: what git declares of that kind of object,
 *        in every application file and in the platform file, without reading the product (to prefill an edit, to say
 *        which live objects Manage may change, and for the drift view); read at most once a minute
 *
 * Who may ask: the owner team of the application (spec.owner of its production instance in the catalog) or the groups
 * of console.actions.groups (default backstage-admin); objects of the platform only those groups. Approval is in
 * GitHub (CODEOWNERS of the application's file).
 */

type OwnerView = { kind: 'application' | 'platform'; name: string; title: string; owner?: string; canWrite: boolean };

/** The branch of a Manage pull request: console/manage-<service>-<object>-<id>-<time> (PR_PREFIX + slug). */
const SLUG = 'manage-';
const slugOf = (r: { service: string; object: string; id: string }) => `${SLUG}${r.service}-${r.object}-${r.id}`.replace(/[^a-z0-9-]/g, '-');
/** The parts a pending pull request carries in its body (one line the route writes and reads). */
const MARK = /<!-- manage: (\{.*\}) -->/;

const ACTIONS: ManageAction[] = ['create', 'update', 'delete'];

/** The request body checked: anything else is a 400. */
export function readRequest(body: unknown): ChangeRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const bad = (m: string) => new ChangeError(400, m);
  if (typeof b.service !== 'string' || typeof b.object !== 'string') throw bad('service and object are required.');
  if (!ACTIONS.includes(b.action as ManageAction)) throw bad('action is create, update or delete.');
  const o = b.owner as Record<string, unknown> | undefined;
  let owner: Owner | undefined;
  if (o?.kind === 'platform') owner = { kind: 'platform' };
  else if (o?.kind === 'application' && typeof o.name === 'string') owner = { kind: 'application', name: o.name };
  if (!owner) throw bad('owner is { kind: "application", name } or { kind: "platform" }.');
  if (b.spec !== undefined && (typeof b.spec !== 'object' || b.spec === null || Array.isArray(b.spec))) throw bad('spec is an object.');
  return {
    service: b.service,
    object: b.object,
    action: b.action as ManageAction,
    owner,
    id: typeof b.id === 'string' ? b.id : undefined,
    spec: b.spec as Record<string, unknown> | undefined,
    reason: typeof b.reason === 'string' ? b.reason.slice(0, 2000) : undefined,
    dryRun: b.dryRun === true,
  };
}

/** The body of the pull request: who, why, what; the last line lets /pending read it back. */
export function pullBody(r: ChangeRequest & { id: string }, user: string, file: string, diff: string): string {
  const owner = r.owner.kind === 'application' ? `the application **${r.owner.name}**` : '**the platform**';
  return [
    `Asked from the console (Manage) by \`${user}\`: ${r.action} ${r.object} \`${r.id}\` of ${r.service}, for ${owner}.`,
    r.reason ? `\n> ${r.reason.replace(/\n/g, '\n> ')}` : '',
    `\nFile: \`${file}\``,
    '\n```diff',
    diff,
    '```',
    '\nOn merge, the provisioner of the application applies it; a removal is a tombstone (`state: absent`) it deletes.',
    `\n<!-- manage: ${JSON.stringify({ service: r.service, object: r.object, id: r.id, action: r.action, owner: r.owner })} -->`,
  ].join('\n');
}

export default createBackendPlugin({
  pluginId: 'manage',
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
        const groups = config.getOptionalStringArray('console.actions.groups') ?? ['backstage-admin'];
        const token = config.getOptionalConfigArray('integrations.github')?.[0]?.getOptionalString('token');
        const services = new GitHubFiles(config.getOptionalString('console.manage.repo') ?? 'javivillar/refresquito-services', config.getOptionalString('console.manage.branch') ?? 'main', token);

        const who = async (req: express.Request) => {
          const credentials = await httpAuth.credentials(req, { allow: ['user'] });
          const info = await userInfo.getUserInfo(credentials);
          return { credentials, user: info.userEntityRef, refs: info.ownershipEntityRefs, admin: mayAct(info.ownershipEntityRefs, groups) };
        };

        /** The business applications in the catalog: their production instance names the owner team. */
        const applications = async (credentials: Awaited<ReturnType<typeof who>>['credentials']) => {
          const { items } = await catalog.getEntities(
            { filter: { kind: 'component' }, fields: ['metadata.name', 'metadata.title', 'metadata.annotations', 'spec.owner'] },
            { credentials },
          );
          const apps = new Map<string, { title: string; owner?: string }>();
          for (const e of items) {
            const a = e.metadata.annotations ?? {};
            const name = a['refresquito.io/application'];
            if (!name || !NAME.test(name)) continue;
            const pro = (a['refresquito.io/stage'] ?? 'pro') === 'pro';
            if (!apps.has(name) || pro) apps.set(name, { title: e.metadata.title ?? name, owner: (e.spec as { owner?: string } | undefined)?.owner });
          }
          return apps;
        };

        const router = Router();
        router.use(express.json({ limit: '64kb' }));
        const fail = (res: express.Response, e: unknown) => {
          if (e instanceof ChangeError) res.status(e.status).json({ error: e.message, errors: e.errors });
          else {
            logger.warn(`manage: ${(e as Error).message}`);
            res.status(502).json({ error: (e as Error).message });
          }
        };

        router.get('/handlers', async (req, res) => {
          try {
            await httpAuth.credentials(req, { allow: ['user'] });
            res.json(handlers().map(h => ({ service: h.service, object: h.object, label: h.label })));
          } catch (e) {
            res.status(401).json({ error: (e as Error).message });
          }
        });

        router.get('/owners', async (req, res) => {
          try {
            const w = await who(req);
            const apps = await applications(w.credentials);
            const out: OwnerView[] = [...apps.entries()]
              .map(([name, a]) => ({ kind: 'application' as const, name, title: a.title, owner: a.owner, canWrite: w.admin || ownsEntity(w.refs, a.owner) }))
              .sort((x, y) => x.title.localeCompare(y.title));
            out.push({ kind: 'platform', name: 'platform', title: 'Refresquito platform', canWrite: w.admin });
            res.json(out);
          } catch (e) {
            fail(res, e);
          }
        });

        router.post('/changes', async (req, res) => {
          try {
            const w = await who(req);
            const r = readRequest(req.body);
            const h = handlerFor(r.service, r.object);
            const target = h.target(r.owner);
            if (r.owner.kind === 'application') {
              const app = (await applications(w.credentials)).get(r.owner.name);
              if (!app) throw new ChangeError(404, `There is no application ${r.owner.name} in the catalog.`);
              if (!w.admin && !ownsEntity(w.refs, app.owner)) throw new ChangeError(403, `Only the team of ${r.owner.name} (${app.owner ?? 'no owner'}) or ${groups.join(', ')} can change it.`);
            } else if (!w.admin) {
              throw new ChangeError(403, `Only ${groups.join(', ')} can change objects of the platform.`);
            }
            if (target.repo !== 'services') throw new ChangeError(501, 'Changes in the repository of the application are not supported yet.');
            // the platform file of a service is created by its first object; an application's file must exist
            const before = await services.get(target.path).then(
              f => f.text,
              () => {
                if (r.owner.kind === 'platform' && r.action === 'create') return '';
                throw new ChangeError(404, `${target.path} is not in refresquito-services.`);
              },
            );
            const { text, summary } = applyChange(before, h, r);
            const id = (r.action === 'create' ? (r.spec?.name as string) : r.id) as string;
            const diff = lineDiff(before, text);
            if (r.dryRun) {
              res.json({ file: target.path, diff, summary });
              return;
            }
            const pull = await services.pullRequest(slugOf({ ...r, id }), `Manage: ${summary}`, pullBody({ ...r, id }, w.user, target.path, diff), [{ path: target.path, text }]);
            logger.info(`manage: ${summary} by ${w.user}: pull request #${pull.number}`);
            res.json({ pull, file: target.path, diff, summary });
          } catch (e) {
            fail(res, e);
          }
        });

        // the files of the applications (and the platform files), read at most once a minute: /declared asks for all
        const APPS = 'bootstrap/app-of-apps/apps';
        let cache: { at: number; files: Map<string, string | undefined> } = { at: 0, files: new Map() };
        const read = async (path: string) => {
          if (Date.now() - cache.at > 60_000) cache = { at: Date.now(), files: new Map() };
          if (!cache.files.has(path)) cache.files.set(path, await services.get(path).then(f => f.text, () => undefined));
          return cache.files.get(path);
        };
        router.get('/declared', async (req, res) => {
          try {
            await httpAuth.credentials(req, { allow: ['user'] });
            const h = handlerFor(String(req.query.service ?? ''), String(req.query.object ?? ''));
            if (!h.declared) throw new ChangeError(501, `Manage cannot list what git declares of ${h.object} of ${h.service} yet.`);
            const out: Array<{ owner: Owner; id: string; spec: Record<string, unknown>; gone: boolean }> = [];
            const files = (await services.list(APPS)).filter(f => /^[a-z0-9-]+\.ya?ml$/.test(f.name));
            for (const f of files) {
              const text = await read(f.path);
              if (!text) continue;
              const owner: Owner = { kind: 'application', name: f.name.replace(/\.ya?ml$/, '') };
              for (const d of h.declared(parse(text), owner)) out.push({ owner, ...d });
            }
            let platformPath: string | undefined;
            try {
              platformPath = h.target({ kind: 'platform' }).path;
            } catch {
              platformPath = undefined; // a kind of object that only applications have
            }
            const platformText = platformPath ? await read(platformPath) : undefined;
            if (platformText) for (const d of h.declared(parse(platformText), { kind: 'platform' })) out.push({ owner: { kind: 'platform' }, ...d });
            res.json(out);
          } catch (e) {
            fail(res, e);
          }
        });

        router.get('/pending', async (req, res) => {
          try {
            await httpAuth.credentials(req, { allow: ['user'] });
            const service = typeof req.query.service === 'string' ? req.query.service : undefined;
            const pulls = (await services.openPulls()).filter(p => p.branch.startsWith(`${PR_PREFIX}${SLUG}`));
            res.json(
              pulls
                .map(p => {
                  const m = MARK.exec(p.body);
                  const meta = m ? (JSON.parse(m[1]) as { service: string; object: string; id: string; action: string; owner: Owner }) : undefined;
                  return { number: p.number, title: p.title, url: p.url, created: p.created, ...meta };
                })
                .filter(p => !service || p.service === service),
            );
          } catch (e) {
            fail(res, e);
          }
        });

        httpRouter.use(router);
      },
    });
  },
});
