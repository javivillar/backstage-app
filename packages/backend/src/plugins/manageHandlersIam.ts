import { isMap, isSeq, type Document, type YAMLMap, type YAMLSeq } from 'yaml';
import {
  appOrPlatform,
  block,
  ChangeError,
  type Declared,
  editList,
  entriesOf,
  list,
  platformList,
  registerHandler,
  type Touched,
} from './manageModel';
import { changeBlock, declaredBlock } from './manageBlocks';

/**
 * Manage › IAM (Keycloak): groups and SSO clients, never people (they come from SSO and onboarding: no user is created
 * or deleted from Manage).
 *
 * - Of the platform: manage.groups / manage.clients of bootstrap/app-of-apps/platform/iam.yaml, applied by the reconciler
 *   of iam-oneke (charts/iam-oneke/README.md, Platform objects). A client is keyed by name (its clientId); title is the
 *   name Keycloak shows. A client secret is never in git: the reconciler writes it to the Secret secretName.
 * - Of an application: its block sso. Its client is the application's own (one per stage, made by its provisioner):
 *   Manage changes its settings and can retire it (the block's tombstone), never adds a second one; its roles are sso.roles; a group of the application is a group a role is
 *   given to (sso.roles[].groups): deleting it there takes the role from it, and the provisioner deletes the group when
 *   it is the application's own and has nothing left.
 */

const GROUP = /^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/;
const CLIENT = /^[a-z0-9][a-z0-9._-]{1,62}$/;
const ROLE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : undefined);
const CLIENT_TYPES = ['confidential', 'public', 'service-account'];
const GROUP_KINDS = ['access', 'role', 'team', 'data'];

function checkUris(v: unknown, what: string): string[] {
  const l = strs(v);
  if (v !== undefined && !l) return [`${what}: a list of URLs.`];
  return (l ?? []).filter(u => !/^https?:\/\/[^\s]+$/.test(u) && u !== '+' && u !== '*').map(u => `${what}: "${u}" is not an http(s) URL.`);
}

// ---- groups

/** The role entries of sso.roles of an application file (mappings with a name). */
function roles(doc: Document, touched: Touched): YAMLSeq {
  return list(doc, block(doc, 'sso', touched), 'roles', touched);
}
const roleName = (it: unknown) => (isMap(it) ? String(it.get('name') ?? '') : '');
const groupsOf = (it: unknown): unknown[] => {
  const g = isMap(it) ? it.get('groups') : undefined;
  return isSeq(g) ? (g.toJSON() as unknown[]) : [];
};
const gName = (g: unknown) => (typeof g === 'string' ? g : g && typeof g === 'object' ? String((g as { name?: unknown }).name ?? '') : '');
const gGone = (g: unknown) => !!g && typeof g === 'object' && (g as { state?: unknown }).state === 'absent';

/** The role entry rewritten with its groups changed (the whole item: a role is one line of the file). */
function setGroups(doc: Document, l: YAMLSeq, i: number, groups: unknown[]) {
  const cur = (l.items[i] as YAMLMap).toJSON() as Record<string, unknown>;
  l.items[i] = doc.createNode({ ...cur, groups });
}

function applyAppGroup(doc: Document, action: string, id: string, spec: Record<string, unknown>, touched: Touched) {
  const l = roles(doc, touched);
  const role = str(spec.role);
  const holding = l.items.map((it, i) => ({ i, name: roleName(it), groups: groupsOf(it) })).filter(r => r.groups.some(g => gName(g) === id && !gGone(g)));
  if (action === 'create' || action === 'update') {
    if (action === 'create' && holding.length) throw new ChangeError(409, `The group ${id} already has a role of this application (${holding.map(h => h.name).join(', ')}).`);
    if (action === 'update' && !holding.length) throw new ChangeError(404, `The group ${id} has no role of this application.`);
    const i = l.items.findIndex(it => roleName(it) === role && !(isMap(it) && it.get('state') === 'absent'));
    if (i < 0) throw new ChangeError(422, `role: ${role ?? '(none)'} is not a role of this application.`);
    // update: it moves to the role given (the role it had is taken away by a tombstone)
    for (const h of holding) if (h.i !== i) setGroups(doc, l, h.i, h.groups.map(g => (gName(g) === id ? { name: id, state: 'absent' } : g)));
    const groups = groupsOf(l.items[i]).filter(g => gName(g) !== id);
    setGroups(doc, l, i, [...groups, id]);
    return;
  }
  if (!holding.length) throw new ChangeError(404, `The group ${id} has no role of this application.`);
  for (const h of holding) setGroups(doc, l, h.i, h.groups.map(g => (gName(g) === id ? { name: id, state: 'absent' } : g)));
}

function appGroups(doc: Document): Declared[] {
  const l = doc.getIn(['platform', 'sso', 'roles']);
  if (!isSeq(l)) return [];
  const out = new Map<string, Declared>();
  for (const it of l.items) {
    if (!isMap(it) || it.get('state') === 'absent') continue;
    for (const g of groupsOf(it)) {
      const name = gName(g);
      if (!name) continue;
      const prev = out.get(name);
      if (gGone(g)) {
        if (!prev) out.set(name, { id: name, spec: { name }, gone: true });
      } else out.set(name, { id: name, spec: { name, role: roleName(it) }, gone: false });
    }
  }
  return [...out.values()];
}

registerHandler({
  service: 'iam',
  object: 'group',
  label: 'Keycloak group',
  target: appOrPlatform('iam'),
  validate: (action, spec) => [
    ...(action === 'create' && !GROUP.test(str(spec.name) ?? '') ? ['name: 2 to 63 letters, digits and ._- (no "/").'] : []),
    ...(spec.kind !== undefined && !GROUP_KINDS.includes(String(spec.kind)) ? [`kind: ${GROUP_KINDS.join(', ')}.`] : []),
    ...(spec.parent !== undefined && spec.parent !== '' && !/^\/?[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(String(spec.parent)) ? ['parent: the name or /path of a group.'] : []),
    ...(spec.realmRoles !== undefined && !strs(spec.realmRoles) ? ['realmRoles: a list of roles.'] : []),
  ],
  apply: (doc, req, touched) => {
    const s = req.spec ?? {};
    if (req.owner.kind === 'application') {
      applyAppGroup(doc, req.action, req.id, s, touched);
      return;
    }
    editList(doc, platformList(doc, 'groups', touched), req.action, req.id, {
      description: str(s.description),
      parent: str(s.parent) || undefined,
      kind: str(s.kind) || undefined,
      realmRoles: strs(s.realmRoles),
    }, false);
  },
  declared: (doc, owner) => (owner.kind === 'platform' ? entriesOf(doc, ['manage', 'groups']) : appGroups(doc)),
});

// ---- roles of an application (its client's roles: sso.roles)

registerHandler({
  service: 'iam',
  object: 'role',
  label: 'application role',
  target: owner => {
    if (owner.kind !== 'application') throw new ChangeError(422, 'Roles of the platform are roles of its clients: change the client.');
    return appOrPlatform('iam')(owner);
  },
  validate: (action, spec) => [
    ...(action === 'create' && !ROLE.test(str(spec.name) ?? '') ? ['name: 2 to 40 lowercase letters, digits and "-" (the role is <application>-<name>).'] : []),
    ...(action !== 'delete' && action === 'create' && !str(spec.description) ? ['description: what someone with the role may do.'] : []),
  ],
  apply: (doc, req, touched) => {
    const s = req.spec ?? {};
    editList(doc, roles(doc, touched), req.action, req.id, { description: str(s.description) }, false);
  },
  declared: doc => entriesOf(doc, ['platform', 'sso', 'roles']).map(d => ({ ...d, spec: { name: d.spec.name, description: d.spec.description } })),
});

// ---- SSO clients: of the platform (manage.clients), or the client of an application (its block sso: its settings)

/** platform.sso.testUsers from a form (a select gives text): true, false or 1 to 5 per role; undefined when it is not one. */
export function testUsersOf(v: unknown): boolean | number | undefined {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false' || v === '0' || v === 0) return false;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? (n === 1 ? true : n) : undefined;
}

export function clientFields(spec: Record<string, unknown>) {
  const roleList = strs(spec.roles);
  return {
    title: str(spec.title),
    description: str(spec.description),
    type: str(spec.type) || undefined,
    redirectUris: strs(spec.redirectUris),
    webOrigins: strs(spec.webOrigins),
    roles: roleList?.map(r => ({ name: r })),
    secretName: str(spec.secretName) || undefined,
  };
}

registerHandler({
  service: 'iam',
  object: 'client',
  label: 'SSO client',
  target: appOrPlatform('iam'),
  validate: (action, spec) => {
    const e: string[] = [];
    if (action === 'create' && !CLIENT.test(str(spec.name) ?? '')) e.push('name: the clientId, 2 to 63 lowercase letters, digits and ._-');
    if (spec.type !== undefined && !CLIENT_TYPES.includes(String(spec.type))) e.push(`type: ${CLIENT_TYPES.join(', ')}.`);
    if (spec.testUsers !== undefined && testUsersOf(spec.testUsers) === undefined) e.push('testUsers: true, false or 1 to 5 per role.');
    e.push(...checkUris(spec.extraRedirectUris, 'extraRedirectUris'));
    if (spec.type === 'public' && str(spec.secretName)) e.push('secretName: a public client has no secret.');
    if (spec.secretName !== undefined && spec.secretName !== '' && !CLIENT.test(String(spec.secretName))) e.push('secretName: the name of a Kubernetes Secret.');
    e.push(...checkUris(spec.redirectUris, 'redirectUris'), ...checkUris(spec.webOrigins, 'webOrigins'));
    return e;
  },
  apply: (doc, req, touched) => {
    if (req.owner.kind === 'application') {
      // the client of an application is its block sso (one client per stage, named as the deployment): its settings
      const s = req.spec ?? {};
      if (req.action === 'create') throw new ChangeError(409, `${req.owner.name} already has its client: every application signs its users in.`);
      const testUsers = testUsersOf(s.testUsers);
      changeBlock(doc, 'sso', req.action, req.id, req.owner, {
        extraRedirectUris: strs(s.extraRedirectUris),
        testUsers,
        fromBackstage: typeof s.fromBackstage === 'boolean' ? s.fromBackstage : undefined,
      }, touched);
      return;
    }
    const fields = clientFields(req.spec ?? {});
    // roles given as names keep the descriptions they had
    const l = platformList(doc, 'clients', touched);
    if (fields.roles && req.action === 'update') {
      const cur = l.items.find(it => isMap(it) && it.get('name') === req.id);
      const had = new Map<string, unknown>(((isMap(cur) ? (cur.toJSON() as { roles?: Array<{ name: string; description?: string }> }).roles : undefined) ?? []).map(r => [r.name, r]));
      fields.roles = fields.roles.map(r => (had.get(r.name) as { name: string }) ?? r);
    }
    editList(doc, l, req.action, req.id, fields, false);
  },
  declared: (doc, owner) =>
    owner.kind === 'platform'
      ? entriesOf(doc, ['manage', 'clients'])
      : declaredBlock(doc, 'sso', b => ({ extraRedirectUris: b.extraRedirectUris ?? [], testUsers: b.testUsers ?? false, fromBackstage: b.fromBackstage ?? false })),
});
