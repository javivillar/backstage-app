import { changeBlock, declaredBlock } from './manageBlocks';
import { appFile, appOrPlatform, ChangeError, editList, entriesOf, platformList, registerHandler } from './manageModel';

/**
 * Manage › Business intelligence (Superset).
 *
 * - Of the platform: the shared database connections, manage.connections of bootstrap/app-of-apps/platform/superset.yaml,
 *   applied by the reconciler of superset-oneke (charts/superset-oneke/INSTALL.md, Platform objects). A password is
 *   never in git: only a reference to a property of the store (passwordFrom).
 * - Of an application: its block dashboards (the dashboards its image brings, over its own database): object
 *   'dashboards', on (create) or torn down (delete: the block's tombstone).
 */

const CONN_NAME = /^[A-Za-z0-9][A-Za-z0-9 ()._-]{0,79}$/;
const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const DB = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$/;
const STORE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const BACKENDS = ['postgresql', 'postgresql+psycopg2'];
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);

/** passwordFrom given as "<storeKey>.<property>" in a form, or as the mapping itself. */
export function passwordFrom(v: unknown): { storeKey: string; property: string } | undefined {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return typeof o.storeKey === 'string' && typeof o.property === 'string' ? { storeKey: o.storeKey, property: o.property } : undefined;
  }
  const s = str(v);
  const at = s ? s.lastIndexOf('.') : -1;
  return s && at > 0 ? { storeKey: s.slice(0, at), property: s.slice(at + 1) } : undefined;
}

export function connectionFields(spec: Record<string, unknown>) {
  const port = spec.port === undefined || spec.port === '' ? undefined : Number(spec.port);
  return {
    backend: str(spec.backend),
    host: str(spec.host),
    port,
    database: str(spec.database),
    username: str(spec.username),
    passwordFrom: spec.passwordFrom === undefined ? undefined : passwordFrom(spec.passwordFrom),
    exposeInSqlLab: typeof spec.exposeInSqlLab === 'boolean' ? spec.exposeInSqlLab : undefined,
    allowDml: typeof spec.allowDml === 'boolean' ? spec.allowDml : undefined,
  };
}

export function validateConnection(action: string, spec: Record<string, unknown>): string[] {
  const e: string[] = [];
  const need = action === 'create';
  if (need && !CONN_NAME.test(str(spec.name) ?? '')) e.push('name: 1 to 80 letters, digits, spaces and ()._-');
  if ((need || spec.backend !== undefined) && !BACKENDS.includes(str(spec.backend) ?? '')) e.push(`backend: ${BACKENDS.join(' or ')}.`);
  if ((need || spec.host !== undefined) && !HOST.test(str(spec.host) ?? '')) e.push('host: a host name.');
  if ((need || spec.database !== undefined) && !DB.test(str(spec.database) ?? '')) e.push('database: the name of the database.');
  if (spec.port !== undefined && spec.port !== '' && !(Number.isInteger(Number(spec.port)) && Number(spec.port) > 0 && Number(spec.port) < 65536)) e.push('port: 1 to 65535.');
  if (spec.username !== undefined && !DB.test(str(spec.username) ?? '')) e.push('username: a database user.');
  if (spec.passwordFrom !== undefined) {
    const p = passwordFrom(spec.passwordFrom);
    if (!p || !STORE.test(p.storeKey) || !STORE.test(p.property)) e.push('passwordFrom: <storeKey>.<property> of the store (never the password itself).');
  }
  if (spec.allowDml === true) e.push('allowDml: shared connections of the platform are read-only.');
  return e;
}

registerHandler({
  service: 'superset',
  object: 'connection',
  label: 'database connection',
  target: appOrPlatform('superset'),
  validate: validateConnection,
  apply: (doc, req, touched) => {
    if (req.owner.kind === 'application') throw new ChangeError(422, 'The connection of an application is the one of its dashboards block (its own database).');
    editList(doc, platformList(doc, 'connections', touched), req.action, req.id, connectionFields(req.spec ?? {}), false);
  },
  declared: (doc, owner) => (owner.kind === 'platform' ? entriesOf(doc, ['manage', 'connections']) : []),
});

registerHandler({
  service: 'superset',
  object: 'dashboards',
  label: 'dashboards',
  target: appFile,
  validate: () => [],
  apply: (doc, req, touched) => {
    if (req.action === 'update') throw new ChangeError(422, 'The dashboards of an application come from its image (platform/dashboards/): change them there.');
    changeBlock(doc, 'dashboards', req.action, req.id, req.owner, {}, touched);
  },
  declared: doc => declaredBlock(doc, 'dashboards', () => ({})),
});
