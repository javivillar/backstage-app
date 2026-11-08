import { changeBlock, declaredBlock } from './manageBlocks';
import { appOrPlatform, ChangeError, editList, entriesOf, platformList, registerHandler } from './manageModel';

/**
 * Manage › API management (Gravitee): the APIs of the gateway.
 *
 * - Of the platform: manage.apis of bootstrap/app-of-apps/platform/gravitee.yaml, applied by the reconciler of
 *   gravitee-oneke (charts/gravitee-oneke/GRAVITEE.md §6): each entry an API at a path under /gateway/.
 * - Of an application: its block gateway, one API at /gateway/<app>/ made by its provisioner (manageBlocks): create
 *   turns it on, update sets its team, delete is the block's tombstone.
 */

const PATH = /^\/gateway\/[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?\/?$/;
const API_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,49}$/;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);

function checkUrl(v: unknown): string[] {
  try {
    const u = new URL(String(v));
    return u.protocol === 'http:' || u.protocol === 'https:' ? [] : ['target: an http(s) URL.'];
  } catch {
    return ['target: an http(s) URL.'];
  }
}

/** The fields of a platform API as the reconciler reads them (the rest of the spec is ignored). */
export function apiFields(spec: Record<string, unknown>) {
  const path = str(spec.path);
  return {
    path: path && !path.endsWith('/') ? `${path}/` : path,
    target: str(spec.target),
    description: str(spec.description),
    version: str(spec.version),
    visibility: str(spec.visibility),
    plan: str(spec.plan),
    team: str(spec.team),
  };
}

export function validateApi(action: string, spec: Record<string, unknown>): string[] {
  const e: string[] = [];
  if (action === 'create' && !API_NAME.test(str(spec.name) ?? '')) e.push('name: 1 to 50 letters, digits, spaces, ".", "_" or "-".');
  if (spec.path !== undefined && !PATH.test(str(spec.path) ?? '')) e.push('path: /gateway/<name>/, lowercase letters, digits and "-".');
  if (spec.target !== undefined) e.push(...checkUrl(spec.target));
  if (spec.team !== undefined && !/^[a-z0-9][a-z0-9-]{1,62}$/.test(String(spec.team))) e.push('team: a gravitee-team-* group.');
  if (spec.visibility !== undefined && !['PUBLIC', 'PRIVATE'].includes(String(spec.visibility))) e.push('visibility: PUBLIC or PRIVATE.');
  if (spec.plan !== undefined && !['jwt', 'keyless'].includes(String(spec.plan))) e.push('plan: jwt (a Keycloak token) or keyless.');
  if (spec.description !== undefined && String(spec.description).length > 500) e.push('description: at most 500 characters.');
  return e;
}

registerHandler({
  service: 'gravitee',
  object: 'api',
  label: 'gateway API',
  target: appOrPlatform('gravitee'),
  validate: validateApi,
  apply: (doc, req, touched) => {
    const s = req.spec ?? {};
    if (req.owner.kind === 'application') {
      changeBlock(doc, 'gateway', req.action, req.id, req.owner, { team: str(s.team) }, touched);
      return;
    }
    const fields = apiFields(s);
    if (req.action === 'create' && (!fields.path || !fields.target)) throw new ChangeError(422, 'The change is not valid.', ['path and target are required for an API of the platform.']);
    editList(doc, platformList(doc, 'apis', touched), req.action, req.id, fields, false);
  },
  declared: (doc, owner) => (owner.kind === 'platform' ? entriesOf(doc, ['manage', 'apis']) : declaredBlock(doc, 'gateway', b => ({ team: b.team }))),
});
