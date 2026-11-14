import express, { Router } from 'express';
import { GitHubFiles } from '../clusterVms';
import { BpmnError, bpmnPath, bpmnPull, readBpmn, readTarget } from './bpmnModel';
import { ContinuityGraph, type MapEntity, readDefaults } from './continuityModel';
import { buildMap } from './mapModel';
import {
  countsOf,
  type Organisation,
  OrganisationError,
  organisationFromRows,
  organisationPath,
  organisationPull,
  organisationView,
  organisationYaml,
  ownershipOf,
  parseOrganisation,
  PROVIDER_NAME,
  readOrganisation,
  type Side,
  SIDES,
  TEMPLATE_SHEET,
  templateSheets,
  withOwner,
} from './organisationModel';
import { type BusinessMapRouteDeps, statusOf, whoAsks } from './previewRouter';
import { providerConfig } from './provider';
import { readUpload, writeXlsx } from './sheets';

/**
 * The organisations and the process models of the business map (organisationModel.ts, bpmnModel.ts):
 *
 *   GET  /api/business-map/organisation?namespace=<customer>
 *        → { namespace, may, keycloak, customer?, provider?, applications }: both organisations, each person with
 *        whether it has a Keycloak user, and who answers for each business application of the customer
 *   GET  /api/business-map/organisation/template?side=&namespace=   the .xlsx template, with the organisation when there is one
 *   POST /api/business-map/organisation/preview   { side, namespace, title?, file (data URL), fileName? }
 *        → { organisation, counts, errors, replaces }: what the file holds; writes nothing
 *   POST /api/business-map/organisation           { side, namespace, organisation } → { pull, path }
 *   POST /api/business-map/organisation/owner     { side, namespace, application, user? } → { pull, path }
 *   GET  /api/business-map/bpmn?namespace=&process=   → { xml, path, url } (404 when the process has no model)
 *   POST /api/business-map/bpmn   { namespace, process, title?, fileName?, xml } → { pull, path }
 *
 * Every change is a pull request in businessMap.repo (refresquito-services). Who may: business-architect,
 * backstage-admin and console.actions.groups. "In Keycloak" is read from the catalog: the User entities the Keycloak
 * provider gives it.
 */

const TTL_MS = 60_000;
const NAME = /^[a-z0-9]([-a-z0-9.]{0,61}[a-z0-9])?$/;
const APP_TYPES = new Set(['business-application', 'business-service']);
/** What the map needs of the catalog (the same fields the route /map reads). */
const MAP_FIELDS = [
  'kind', 'metadata.name', 'metadata.namespace', 'metadata.title', 'metadata.annotations', 'metadata.description', 'spec.type', 'spec.criticality', 'spec.rpo', 'spec.rto',
  'spec.mtpd', 'spec.retention', 'spec.workaround', 'spec.parentProcess', 'spec.owner', 'spec.domain', 'spec.classification', 'spec.subdomainOf', 'spec.lifecycle', 'spec.source',
  'spec.industry', 'spec.version', 'spec.namespace', 'relations',
];

export function createOrganisationRouter(deps: BusinessMapRouteDeps): Router {
  const { config, logger, catalog, httpAuth } = deps;
  const who = whoAsks(deps);
  const src = providerConfig(config);
  const repo = new GitHubFiles(src.repo, src.branch, src.token);
  const blob = (path: string) => `https://github.com/${src.repo}/blob/${src.branch}/${path}`;
  const defaults = readDefaults(config.getOptional('businessMap.criticality'));

  // a file of the repository, kept a minute (the pages read the same two or three files again and again)
  const cache = new Map<string, { at: number; text: string | null }>();
  const fileOf = async (path: string): Promise<string | null> => {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.text;
    let text: string | null = null;
    try {
      text = (await repo.get(path)).text;
    } catch (e) {
      if (!/answered 404/.test((e as Error).message)) throw e;
    }
    cache.set(path, { at: Date.now(), text });
    return text;
  };
  const organisationOf = async (side: Side, namespace: string): Promise<Organisation | undefined> => {
    const path = organisationPath(side, namespace);
    const text = await fileOf(path);
    if (text === null) return undefined;
    try {
      return parseOrganisation(text, { side, name: side === 'provider' ? PROVIDER_NAME : namespace });
    } catch (e) {
      logger.warn(`business-map: ${path} is left out: ${(e as Error).message}`);
      return undefined;
    }
  };
  type Credentials = Awaited<ReturnType<typeof httpAuth.credentials>>;
  /** The user names the catalog has from Keycloak; undefined when it has none (nothing to compare with). */
  const usersOf = async (credentials: Credentials): Promise<Set<string> | undefined> => {
    const { items } = await catalog.getEntities({ filter: [{ kind: 'user' }], fields: ['metadata.name'] }, { credentials });
    return items.length ? new Set(items.map(u => u.metadata.name.toLowerCase())) : undefined;
  };
  /** The business applications under the processes of a customer. */
  const applicationsOf = async (credentials: Credentials, namespace: string) => {
    const { items } = await catalog.getEntities(
      {
        filter: [{ kind: 'businessprocess' }, { kind: 'referencemodel' }, { kind: 'domain' }, { kind: 'system' }, { kind: 'component' }, { kind: 'resource' }],
        fields: MAP_FIELDS,
      },
      { credentials },
    );
    const map = buildMap(new ContinuityGraph(items as MapEntity[], defaults), defaults, namespace);
    const rank = { critical: 0, important: 1, standard: 2 } as Record<string, number>;
    const apps = new Map<string, { name: string; title: string; ref: string; criticality?: string; processes: number }>();
    for (const p of map.processes) {
      for (const s of p.services.filter(x => APP_TYPES.has(x.type ?? ''))) {
        const name = s.ref.split('/').pop() ?? s.ref;
        const a = apps.get(s.ref) ?? { name, title: s.title, ref: s.ref, processes: 0 };
        a.processes += 1;
        if (a.criticality === undefined || (rank[p.criticality] ?? 9) < (rank[a.criticality] ?? 9)) a.criticality = p.criticality;
        apps.set(s.ref, a);
      }
    }
    return { namespace: map.namespace ?? namespace, applications: [...apps.values()].sort((a, b) => a.title.localeCompare(b.title)) };
  };
  const fail = (res: express.Response, e: unknown) => {
    if (e instanceof OrganisationError || e instanceof BpmnError) {
      res.status(400).json({ error: e.message });
      return;
    }
    logger.warn(`business-map: ${(e as Error).message}`);
    res.status(statusOf(e, 502)).json({ error: (e as Error).message });
  };
  const sideOf = (v: unknown): Side => {
    if (!SIDES.includes(v as Side)) throw new OrganisationError(`side is one of ${SIDES.join(', ')}.`);
    return v as Side;
  };
  const namespaceOf = (v: unknown): string => {
    if (typeof v !== 'string' || !NAME.test(v)) throw new OrganisationError('namespace is the name of a customer: lowercase letters, digits and "-".');
    return v;
  };
  const nameOf = (side: Side, namespace: string) => (side === 'provider' ? PROVIDER_NAME : namespace);

  const router = Router();
  router.get('/organisation', async (req, res) => {
    try {
      const w = await who(req);
      const asked = typeof req.query.namespace === 'string' && req.query.namespace ? namespaceOf(req.query.namespace) : undefined;
      const { namespace, applications } = await applicationsOf(w.credentials, asked ?? '');
      const [customer, provider, users] = await Promise.all([namespace ? organisationOf('customer', namespace) : undefined, organisationOf('provider', namespace), usersOf(w.credentials)]);
      res.json({
        namespace,
        may: w.may,
        keycloak: users !== undefined,
        customer: customer && organisationView(customer, users, namespace),
        provider: provider && organisationView(provider, users, namespace),
        applications: ownershipOf(applications, customer, provider, users),
        paths: { customer: organisationPath('customer', namespace), provider: organisationPath('provider', namespace) },
      });
    } catch (e) {
      fail(res, e);
    }
  });

  router.get('/organisation/template', async (req, res) => {
    try {
      await who(req);
      const side = sideOf(req.query.side);
      const namespace = namespaceOf(req.query.namespace);
      const org = await organisationOf(side, namespace);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="organisation-${nameOf(side, namespace)}.xlsx"`);
      res.send(writeXlsx(templateSheets(org)));
    } catch (e) {
      fail(res, e);
    }
  });

  router.post('/organisation/preview', express.json({ limit: '25mb' }), async (req, res) => {
    try {
      const w = await who(req);
      if (!w.may) {
        res.status(403).json({ error: `Only ${w.groups.join(', ')} may import an organisation.` });
        return;
      }
      const side = sideOf(req.body?.side);
      const namespace = namespaceOf(req.body?.namespace);
      if (typeof req.body?.file !== 'string' || !req.body.file) throw new OrganisationError('file is the workbook or the CSV, as a data URL.');
      let upload;
      try {
        upload = readUpload(req.body.file, typeof req.body.fileName === 'string' ? req.body.fileName : undefined);
      } catch (e) {
        throw new OrganisationError((e as Error).message);
      }
      const sheet = upload.sheets.find(s => s.name === TEMPLATE_SHEET) ?? upload.sheets[0];
      if (!sheet || !sheet.rows.length) throw new OrganisationError(`${upload.fileName} has no rows.`);
      const current = await organisationOf(side, namespace);
      const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : current?.title;
      const { organisation, errors } = organisationFromRows(sheet.rows, { side, name: nameOf(side, namespace), title });
      const users = await usersOf(w.credentials);
      res.json({ organisation: organisationView(organisation, users, namespace), counts: countsOf(organisation, users), keycloak: users !== undefined, errors, replaces: current !== undefined, fileName: upload.fileName, sheet: sheet.name });
    } catch (e) {
      fail(res, e);
    }
  });

  const save = async (org: Organisation, namespace: string, by: string, what: string) => {
    const path = organisationPath(org.side, namespace);
    const { title, body } = organisationPull(org, by, what, path);
    const pull = await repo.pullRequest(`org-${org.side}-${org.name}`.slice(0, 80), title, body, [{ path, text: organisationYaml(org) }]);
    logger.info(`business-map: ${path} by ${by}: pull request #${pull.number}`);
    return { pull, path };
  };

  router.post('/organisation', express.json({ limit: '5mb' }), async (req, res) => {
    try {
      const w = await who(req);
      if (!w.may) {
        res.status(403).json({ error: `Only ${w.groups.join(', ')} may change an organisation.` });
        return;
      }
      const side = sideOf(req.body?.side);
      const namespace = namespaceOf(req.body?.namespace);
      const org = readOrganisation({ ...(req.body?.organisation ?? {}), side, name: nameOf(side, namespace) }, { side, name: nameOf(side, namespace) });
      res.json(await save(org, namespace, w.user, (await organisationOf(side, namespace)) ? 'new version' : 'first version'));
    } catch (e) {
      fail(res, e);
    }
  });

  router.post('/organisation/owner', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const w = await who(req);
      if (!w.may) {
        res.status(403).json({ error: `Only ${w.groups.join(', ')} may name a product owner.` });
        return;
      }
      const side = sideOf(req.body?.side);
      const namespace = namespaceOf(req.body?.namespace);
      const application = typeof req.body?.application === 'string' ? req.body.application : '';
      const user = typeof req.body?.user === 'string' && req.body.user.trim() ? req.body.user : undefined;
      const org = await organisationOf(side, namespace);
      if (!org) throw new OrganisationError(`There is no ${side} organisation yet: import it first.`);
      const next = withOwner(org, application, user);
      res.json(await save(next, namespace, w.user, `${side} product owner of ${application.trim().toLowerCase()}`));
    } catch (e) {
      fail(res, e);
    }
  });

  router.get('/bpmn', async (req, res) => {
    try {
      await httpAuth.credentials(req, { allow: ['user', 'service'] });
      const target = readTarget(req.query.namespace, req.query.process);
      const path = bpmnPath(target.namespace, target.process);
      const xml = await fileOf(path);
      if (xml === null) {
        res.status(404).json({ error: `The process ${target.namespace}/${target.process} has no model.`, path });
        return;
      }
      res.json({ xml, path, url: blob(path) });
    } catch (e) {
      fail(res, e);
    }
  });

  router.post('/bpmn', express.json({ limit: '6mb' }), async (req, res) => {
    try {
      const w = await who(req);
      if (!w.may) {
        res.status(403).json({ error: `Only ${w.groups.join(', ')} may import the model of a process.` });
        return;
      }
      const target = readTarget(req.body?.namespace, req.body?.process);
      const { xml, summary } = readBpmn(req.body?.xml);
      const path = bpmnPath(target.namespace, target.process);
      const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim().slice(0, 200) : target.process;
      const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName.replace(/[^\w .()-]/g, '').slice(0, 120) : undefined;
      const pullText = bpmnPull(target, title, summary, { by: w.user, fileName, replaces: (await fileOf(path)) !== null });
      const pull = await repo.pullRequest(`bpmn-${target.namespace}-${target.process}`.slice(0, 80), pullText.title, pullText.body, [{ path, text: xml }]);
      logger.info(`business-map: ${path} by ${w.user}: pull request #${pull.number}`);
      res.json({ pull, path });
    } catch (e) {
      fail(res, e);
    }
  });

  return router;
}
