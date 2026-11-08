import { changeBlock, declaredBlock } from './manageBlocks';
import { appFile, ChangeError, NAME, type Owner, registerHandler } from './manageModel';
import { importedDashboard, TEMPLATES, templateDashboard, type TemplateId } from './monitoringTemplates';

/**
 * Manage › Monitoring (Grafana, Prometheus, Loki).
 *
 * - 'monitoring': the block monitoring of an application (bootstrap/app-of-apps/apps/<app>.yaml): Prometheus scrapes its
 *   API and the provisioner keeps its dashboards in Applications/<app>/<stage> of Grafana. Only turned on: the
 *   provisioner has no tombstone for it yet, so it is not removed from here.
 * - 'dashboard': a dashboard of the application's own, the file platform/monitoring/<name>.json of its repository, from
 *   a template (monitoringTemplates.ts) or a Grafana export. It travels in the image of the application: dev gets it
 *   when the image is built, pre and pro when it is promoted. A file named logs or performance replaces the standard one.
 */

const DIR = 'platform/monitoring';
const MAX = 512 * 1024;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);
const templateOf = (v: unknown) => TEMPLATES.find(t => t.id === str(v))?.id;

registerHandler({
  service: 'monitoring',
  object: 'monitoring',
  label: 'monitoring',
  target: appFile,
  validate: () => [],
  apply: (doc, req, touched) => {
    if (req.action === 'update') throw new ChangeError(422, 'Monitoring has nothing to change: it is on or off.');
    if (req.action === 'delete') throw new ChangeError(422, 'Monitoring cannot be turned off from the console yet: ask the platform team.');
    changeBlock(doc, 'monitoring', req.action, req.id, req.owner, {}, touched);
  },
  declared: doc => declaredBlock(doc, 'monitoring', () => ({})),
});

export function validateDashboard(action: string, spec: Record<string, unknown>): string[] {
  const e: string[] = [];
  if (action === 'create' && !NAME.test(str(spec.name) ?? '')) e.push('name: lowercase letters, digits and "-" (it names the file and the uid).');
  const source = str(spec.source) ?? (spec.json ? 'import' : undefined);
  if (action !== 'delete') {
    if (source === 'import') {
      if (!str(spec.json)) e.push('json: paste the dashboard exported from Grafana.');
      else if ((spec.json as string).length > MAX) e.push('json: at most 512 KB.');
    } else if (!templateOf(spec.template)) e.push(`template: one of ${TEMPLATES.map(t => t.id).join(', ')}.`);
  }
  return e;
}

/** The text of the file: the dashboard with two spaces of indentation and a final newline. */
export function dashboardFile(spec: Record<string, unknown>): string {
  const source = str(spec.source) ?? (spec.json ? 'import' : 'template');
  let d: Record<string, unknown>;
  if (source === 'import') {
    try {
      d = importedDashboard(String(spec.json));
    } catch (e) {
      throw new ChangeError(422, 'The change is not valid.', [`json: ${(e as Error).message}.`]);
    }
  } else {
    d = templateDashboard(templateOf(spec.template) as TemplateId);
  }
  const title = str(spec.title);
  if (title) d.title = title;
  return `${JSON.stringify(d, null, 2)}\n`;
}

registerHandler({
  service: 'monitoring',
  object: 'dashboard',
  label: 'dashboard',
  target: (owner: Owner) => {
    if (owner.kind !== 'application') throw new ChangeError(422, 'A dashboard of Manage belongs to an application (the dashboards of the services come with their charts).');
    if (!NAME.test(owner.name)) throw new ChangeError(400, `"${owner.name}" is not the name of an application.`);
    return { repo: 'app', path: DIR };
  },
  validate: validateDashboard,
  apply: () => {
    throw new ChangeError(501, 'A dashboard is a file of the repository of the application.');
  },
  files: {
    dir: DIR,
    path: id => `${DIR}/${id}.json`,
    change: (req, current) => {
      const what = `dashboard ${req.id} of ${req.owner.kind === 'application' ? req.owner.name : 'the platform'}`;
      if (req.action === 'create' && current !== undefined) throw new ChangeError(409, `${DIR}/${req.id}.json is already there: change it instead.`);
      if (req.action !== 'create' && current === undefined) throw new ChangeError(404, `${DIR}/${req.id}.json is not in the repository.`);
      if (req.action === 'delete') return { text: null, summary: `Remove ${what}` };
      const errors = validateDashboard(req.action, req.spec ?? {});
      if (errors.length) throw new ChangeError(422, 'The change is not valid.', errors);
      return { text: dashboardFile(req.spec ?? {}), summary: `${req.action === 'create' ? 'Add' : 'Change'} ${what}` };
    },
    declared: (name, text) => {
      const m = /^([a-z0-9][a-z0-9-]*)\.json$/.exec(name);
      if (!m) return undefined;
      let title: string | undefined;
      let template: string | undefined;
      try {
        const d = JSON.parse(text ?? '{}') as { title?: unknown; tags?: unknown; dashboard?: { title?: unknown; tags?: unknown } };
        const inner = d.dashboard ?? d;
        title = typeof inner.title === 'string' ? inner.title : undefined;
        const tag = Array.isArray(inner.tags) ? inner.tags.find(t => typeof t === 'string' && t.startsWith('template:')) : undefined;
        template = typeof tag === 'string' ? tag.slice('template:'.length) : undefined;
      } catch {
        title = undefined; // a file that is not JSON: the provisioner skips it and says so
      }
      const standard = m[1] === 'logs' || m[1] === 'performance';
      return { id: m[1], spec: { name: m[1], title: title ?? m[1], source: template ? 'template' : 'import', template, replacesStandard: standard }, gone: false };
    },
  },
});
