import { isMap, isPair, isScalar, isSeq, parseDocument, type Document, type Node, type Pair, type YAMLMap, type YAMLSeq } from 'yaml';

/**
 * Manage through git (refresquito-services MANAGE-GITOPS-DESIGN.md): every create, update and delete asked from the
 * console's Manage pages is a pull request on the file that declares the object. An object of a business application
 * lives in its file bootstrap/app-of-apps/apps/<app>.yaml (its platform blocks); the provisioner of the application
 * applies it on merge with the application's marker, and the DataHub ingest joins it to the application's data product.
 *
 * This module is pure: which handler takes a change, how it checks it and how it edits the file. The edit is surgical:
 * only the list that changes is written again, and the items that do not change keep their exact text, so a pull
 * request shows one or two lines and every comment of the file stays. The route (manage.ts) reads the file, checks
 * who may ask and opens the pull request.
 */

export type ManageAction = 'create' | 'update' | 'delete';
export type Owner = { kind: 'application'; name: string } | { kind: 'platform' };
export type ChangeRequest = {
  service: string;
  object: string;
  action: ManageAction;
  owner: Owner;
  /** the object changed or deleted (its name); create takes it from spec.name */
  id?: string;
  spec?: Record<string, unknown>;
  reason?: string;
  /** only the edited file and its diff, no pull request */
  dryRun?: boolean;
};

/** A refusal with the HTTP status the route answers. */
export class ChangeError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 501,
    message: string,
    readonly errors: string[] = [],
  ) {
    super(message);
  }
}

/** The file a change edits: in refresquito-services, or in the application's own repository. */
export type Target = { repo: 'services' | 'app'; path: string };

/**
 * What an edit touched, so that only that is written back and the rest of the file stays byte for byte: the lists it
 * rewrote, the values it replaced (a scalar, or a whole value, at its range), the keys it added to a mapping and the
 * keys it dropped. Handlers do not fill it by hand: block(), list(), editList() and setIn() do.
 */
export type Touched = {
  lists: Set<YAMLSeq>;
  values: Map<Node, { value: unknown; pair: Pair }>;
  added: Array<{ parent?: YAMLMap; key: string; node: Node }>;
  dropped: Array<{ parent: YAMLMap; pair: Pair }>;
};
export const untouched = (): Touched => ({ lists: new Set(), values: new Map(), added: [], dropped: [] });

/**
 * One setting of a mapping of the file (gateway.team, datahub.classification, a block's state…): changed in place
 * when it is there, added when it is not, dropped when value is undefined.
 */
export function setIn(doc: Document, map: YAMLMap, key: string, value: unknown, touched: Touched): void {
  const pair = map.items.find(p => isPair(p) && (isScalar(p.key) ? p.key.value : p.key) === key) as Pair | undefined;
  if (value === undefined) {
    if (!pair) return;
    map.items.splice(map.items.indexOf(pair), 1);
    if (map.range && (pair.key as Node | undefined)?.range) touched.dropped.push({ parent: map, pair });
    return;
  }
  const node = pair?.value as Node | undefined;
  if (pair && node?.range) {
    if (JSON.stringify((node as { toJSON?: () => unknown }).toJSON?.() ?? null) === JSON.stringify(value)) return;
    pair.value = doc.createNode(value);
    touched.values.set(node, { value, pair });
    return;
  }
  map.set(key, doc.createNode(value));
  if (map.range) touched.added.push({ parent: map, key, node: map.get(key, true) as Node });
}

/** One kind of object of one service (e.g. the buckets of SeaweedFS), as the Manage pages change it. */
export type Handler = {
  service: string;
  object: string;
  /** "S3 bucket": for the title of the pull request */
  label: string;
  target(owner: Owner): Target;
  /** what is wrong with the spec for this action; [] when it is fine */
  validate(action: ManageAction, spec: Record<string, unknown>): string[];
  /** edits the document in place and says what it touched; throws ChangeError 404/409 */
  apply(doc: Document, req: ChangeRequest & { id: string }, touched: Touched): void;
  /**
   * What a file declares of this kind of object (GET /api/manage/declared): an application's file for an application,
   * the platform file for the platform. Without it the route answers 501 for this kind.
   */
  declared?(doc: Document, owner: Owner): Declared[];
};

/** An object as git declares it: its name, its fields (state left out) and whether it is a tombstone. */
export type Declared = { id: string; spec: Record<string, unknown>; gone: boolean };

/** The entries of a list of named objects at a path of a file, as Declared (a bare name or a mapping with name). */
export function entriesOf(doc: Document, path: string[]): Declared[] {
  const l = doc.getIn(path);
  if (!isSeq(l)) return [];
  return l.items.flatMap(it => {
    const v = (it as { toJSON?: () => unknown })?.toJSON ? (it as { toJSON: () => unknown }).toJSON() : it;
    if (typeof v === 'string') return [{ id: v, spec: { name: v }, gone: false }];
    if (v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string') {
      const { state, ...spec } = v as Record<string, unknown>;
      return [{ id: (v as { name: string }).name, spec, gone: state === 'absent' }];
    }
    return [];
  });
}

const HANDLERS = new Map<string, Handler>();
const handlerKey = (service: string, object: string) => `${service}/${object}`;

/** Adds the handler of one kind of object (each service registers its own: see the handlers at the end). */
export function registerHandler(h: Handler): void {
  HANDLERS.set(handlerKey(h.service, h.object), h);
}

export function handlerFor(service: string, object: string): Handler {
  const h = HANDLERS.get(handlerKey(service, object));
  if (!h) throw new ChangeError(501, `Manage cannot change ${object} of ${service} yet.`);
  return h;
}

export const handlers = (): Handler[] => [...HANDLERS.values()];

export const NAME = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const strList = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string');

/** The application file of the app-of-apps. */
export const appFile = (owner: Owner): Target => {
  if (owner.kind !== 'application') throw new ChangeError(501, 'Objects of the platform are not managed from here yet.');
  if (!NAME.test(owner.name)) throw new ChangeError(400, `"${owner.name}" is not the name of an application.`);
  return { repo: 'services', path: `bootstrap/app-of-apps/apps/${owner.name}.yaml` };
};

/**
 * The file of the objects of the platform of a service (not of any application): bootstrap/app-of-apps/platform/<file>.yaml,
 * values under `manage:` that the app-of-apps passes to the chart of the service; its reconciler applies them. <file> is
 * the chart without -oneke (iam, gravitee, datahub, superset, seaweedfs, alfrescodms…).
 */
export const platformFile = (file: string): Target => ({ repo: 'services', path: `bootstrap/app-of-apps/platform/${file}.yaml` });

/** The target of a kind of object that may belong to an application or to the platform. */
export const appOrPlatform = (file: string) => (owner: Owner): Target => (owner.kind === 'platform' ? platformFile(file) : appFile(owner));

/** manage.<field> of a platform file, added when missing. */
export function platformList(doc: Document, field: string, touched: Touched): YAMLSeq {
  let m = doc.get('manage');
  if (m === undefined || m === null) {
    m = doc.createNode({});
    doc.set('manage', m);
    touched.added.push({ key: 'manage', node: m as Node });
  }
  if (!isMap(m)) throw new ChangeError(422, 'manage of this file is not a mapping.');
  return list(doc, m, field, touched);
}

/** The id of a change: id for update/delete, spec.name for create. */
export function changeId(req: ChangeRequest): string {
  const id = req.action === 'create' ? str(req.spec?.name) : req.id;
  if (!id) throw new ChangeError(422, req.action === 'create' ? 'The new object needs a name.' : 'Which object? (id)');
  return id;
}

/** platform.<block> of an application file, added (enabled) when missing. */
export function block(doc: Document, name: string, touched: Touched): YAMLMap {
  let platform = doc.getIn(['platform']);
  if (platform === undefined) {
    platform = doc.createNode({});
    doc.set('platform', platform);
    touched.added.push({ key: 'platform', node: platform as Node });
  }
  if (!isMap(platform)) throw new ChangeError(422, 'platform of this file is not a mapping.');
  let b = platform.get(name);
  if (b === undefined) {
    b = doc.createNode({ enabled: true });
    platform.set(name, b);
    if (!touched.added.some(a => a.node === platform)) touched.added.push({ parent: platform, key: name, node: b as Node });
  }
  if (!isMap(b)) throw new ChangeError(422, `platform.${name} of this file is not a mapping.`);
  if (b.get('enabled') !== true) setIn(doc, b, 'enabled', true, touched);
  return b;
}

/** A list of a block (buckets, sites…), added when missing; it is written back when the edit is done. */
export function list(doc: Document, b: YAMLMap, field: string, touched: Touched): YAMLSeq {
  if (!b.has(field)) {
    b.set(field, doc.createNode([]));
    if (b.range) touched.added.push({ parent: b, key: field, node: b.get(field, true) as Node });
  }
  const l = b.get(field);
  if (!isSeq(l)) throw new ChangeError(422, `${field} of this block is not a list.`);
  if (l.range) touched.lists.add(l);
  return l;
}

/** The name of an item of a list: a plain name or a mapping with name. */
const itemName = (it: unknown): string | undefined => {
  if (isScalar(it)) return str(it.value);
  if (isMap(it)) return str(it.get('name'));
  return undefined;
};

/** Index and whether the item is a tombstone (state: absent, kept for the provisioner to remove the object). */
function find(l: YAMLSeq, id: string): { i: number; gone: boolean } | undefined {
  const i = l.items.findIndex(it => itemName(it) === id);
  if (i < 0) return undefined;
  const it = l.items[i];
  return { i, gone: isMap(it) && it.get('state') === 'absent' };
}

/**
 * The generic edit of a list of named objects: create adds { name, ...fields } (or the bare name when it has no other
 * field, as the files write them), or revives a tombstone; update merges the fields; delete turns the item into a
 * tombstone { name, state: absent }, which the provisioner removes on merge (deleting the line would leave the object
 * live: the blocks only add).
 */
export function editList(doc: Document, l: YAMLSeq, action: ManageAction, id: string, fields: Record<string, unknown>, bare: boolean): void {
  const at = find(l, id);
  const clean = Object.fromEntries(Object.entries(fields).filter(([k, v]) => k !== 'name' && v !== undefined));
  if (action === 'create') {
    if (at && !at.gone) throw new ChangeError(409, `${id} already exists.`);
    const node = doc.createNode(bare && Object.keys(clean).length === 0 ? id : { name: id, ...clean });
    if (at) l.items[at.i] = node;
    else l.items.push(node);
    return;
  }
  if (!at || at.gone) throw new ChangeError(404, `There is no ${id}.`);
  if (action === 'delete') {
    l.items[at.i] = doc.createNode({ name: id, state: 'absent' });
    return;
  }
  const cur = l.items[at.i];
  const now: Record<string, unknown> = isMap(cur) ? (cur.toJSON() as Record<string, unknown>) : { name: id };
  const merged = { ...now, ...clean };
  l.items[at.i] = doc.createNode(bare && Object.keys(merged).length === 1 ? id : merged);
}

/** Parses an application file; refuses one that does not parse (the route then changes nothing). */
export function parse(text: string): Document {
  const doc = parseDocument(text, { keepSourceTokens: false });
  if (doc.errors.length) throw new ChangeError(422, `The file does not parse: ${doc.errors[0].message}`);
  return doc;
}

// ---- writing a list back

const PLAIN = /^[A-Za-z0-9_./@-][A-Za-z0-9_ ./@-]*$/;
const RESERVED = /^(true|false|yes|no|on|off|null|~|[-+]?[0-9.]+)$/i;
/** A scalar as the files write it: plain when it can be, else in double quotes. */
const scalar = (v: unknown): string => {
  if (typeof v !== 'string') return String(v);
  return PLAIN.test(v) && !RESERVED.test(v) && v.trim() === v ? v : JSON.stringify(v);
};
/** A value inside a flow item: scalars, lists of scalars as [a, b], small maps as { k: v }. */
const flowValue = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(flowValue).join(', ')}]`;
  if (v && typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${k}: ${flowValue(x)}`).join(', ')} }`;
  return scalar(v);
};

/** The text of an item: as it was in the file when it did not change, else written the way the files write items. */
const itemText = (it: unknown, source: string): string => {
  const n = it as Node;
  if (n?.range && (isScalar(n) || isMap(n) || isSeq(n))) return source.slice(n.range[0], n.range[1]).trimEnd();
  return flowValue((n as { toJSON?: () => unknown })?.toJSON ? (n as { toJSON: () => unknown }).toJSON() : n);
};

/** The column a node starts at in the source. */
const column = (source: string, at: number) => at - (source.lastIndexOf('\n', at - 1) + 1);

/** The new text of a list that was in the file: flow lists stay on their line, block lists keep their indentation. */
function listText(l: YAMLSeq, source: string): string {
  const items = l.items.map(it => itemText(it, source));
  if (l.flow) return `[${items.join(', ')}]`;
  if (!items.length) return '[]';
  const indent = ' '.repeat(column(source, l.range![0]));
  return items.map((t, i) => `${i === 0 ? '' : indent}- ${t}`).join('\n');
}

/** A value written as the files write it, in block style at an indentation (for keys added to the file). */
function blockText(key: string, v: unknown, indent: string): string {
  if (Array.isArray(v)) {
    if (v.every(x => x === null || typeof x !== 'object')) return `${indent}${key}: ${flowValue(v)}`;
    return [`${indent}${key}:`, ...v.map(x => `${indent}  - ${flowValue(x)}`)].join('\n');
  }
  if (v && typeof v === 'object') return [`${indent}${key}:`, ...Object.entries(v).map(([k, x]) => blockText(k, x, `${indent}  `))].join('\n');
  return `${indent}${key}: ${scalar(v)}`;
}

/** The indentation of the keys of a mapping that is in the file. */
const keyIndent = (m: YAMLMap, source: string) => {
  const first = m.items[0]?.key as Node | undefined;
  return ' '.repeat(first?.range ? column(source, first.range[0]) : 0);
};

/**
 * The file with what the edit touched written back in place (lists and values at their range, added keys at the
 * end of their mapping), everything else byte for byte as it was. Edits go from the end of the file to its start, so
 * every range still points at the original text.
 */
function splice(source: string, touched: Touched): string {
  const edits: Array<{ at: number; end: number; text: string }> = [];
  for (const l of touched.lists) {
    const [start, end] = l.range!;
    // a block list's range takes the newline after its last item: give it back
    const nl = !l.flow && source[end - 1] === '\n' ? '\n' : '';
    edits.push({ at: start, end, text: listText(l, source) + nl });
  }
  for (const [node, { value, pair }] of touched.values) {
    const multiline = (isMap(node) || isSeq(node)) && !node.flow;
    if (!multiline) {
      edits.push({ at: node.range![0], end: node.range![1], text: flowValue(value) });
      continue;
    }
    // a block collection (lines under its key) becomes one line after the key: "key: { … }"
    const keyEnd = (pair.key as Node).range![1];
    const colon = source.indexOf(':', keyEnd) + 1;
    const nl = source[node.range![1] - 1] === '\n' ? '\n' : '';
    edits.push({ at: colon, end: node.range![1], text: ` ${flowValue(value)}${nl}` });
  }
  for (const d of touched.dropped) {
    const k = (d.pair.key as Node).range!;
    const v = (d.pair.value as Node | null)?.range ?? k;
    if (d.parent.flow) {
      // inside { a: 1, b: 2 }: the pair and the comma after it (or before it, when it is the last)
      let at = k[0];
      let end = v[1];
      const after = /^\s*,\s*/.exec(source.slice(end));
      if (after) end += after[0].length;
      else {
        const before = /,\s*$/.exec(source.slice(0, at));
        if (before) at -= before[0].length;
      }
      edits.push({ at, end, text: '' });
    } else {
      // its whole lines: from the start of the key's line to the end of the value's last line
      const at = source.lastIndexOf('\n', k[0] - 1) + 1;
      const nl = source.indexOf('\n', Math.max(v[1] - 1, k[1]));
      edits.push({ at, end: nl < 0 ? source.length : nl + 1, text: '' });
    }
  }
  // keys added inside a flow mapping ({ a: 1 }) go in together, after its last pair
  const flowAdds = new Map<YAMLMap, string[]>();
  for (const a of touched.added) {
    if (!a.parent?.range || !a.parent.flow) continue;
    const json = (a.node as { toJSON?: () => unknown }).toJSON?.() ?? a.node;
    flowAdds.set(a.parent, [...(flowAdds.get(a.parent) ?? []), `${a.key}: ${flowValue(json)}`]);
  }
  for (const [parent, pairs] of flowAdds) {
    const close = source.lastIndexOf('}', parent.range![1]);
    const inner = source.slice(source.indexOf('{', parent.range![0]) + 1, close);
    if (inner.trim() === '') edits.push({ at: close - inner.length, end: close, text: ` ${pairs.join(', ')} ` });
    else {
      const at = close - (inner.length - inner.trimEnd().length);
      edits.push({ at, end: at, text: `, ${pairs.join(', ')}` });
    }
  }
  for (const a of touched.added) {
    if (a.parent?.range && a.parent.flow) continue;
    const json = (a.node as { toJSON?: () => unknown }).toJSON?.() ?? a.node;
    if (!a.parent?.range) {
      const tail = source.endsWith('\n') ? '' : '\n';
      edits.push({ at: source.length, end: source.length, text: `${tail}${blockText(a.key, json, '')}\n` });
      continue;
    }
    // after the last line of the mapping (its range ends after that line's newline, or at the end of the file)
    const end = a.parent.range[1];
    const nextNl = source.indexOf('\n', end);
    let at = end;
    if (source[end - 1] !== '\n') at = nextNl < 0 ? source.length : nextNl + 1;
    const lead = at === source.length && !source.endsWith('\n') ? '\n' : '';
    edits.push({ at, end: at, text: `${lead}${blockText(a.key, json, keyIndent(a.parent, source))}\n` });
  }
  let out = source;
  // from the end of the file to its start; two edits at the same place go in the order they were made
  const order = edits.map((e, i) => ({ ...e, i })).sort((x, y) => y.at - x.at || y.i - x.i);
  for (const e of order) out = out.slice(0, e.at) + e.text + out.slice(e.end);
  return out;
}

/** The first line of a platform file the console creates. */
export const NEW_FILE_HEADER = '# Objects of the platform of this service, changed from the console (Manage) by pull request: values under manage: for its chart.';

/** The new text of the file after the change, and a short summary for the pull request. */
export function applyChange(text: string, h: Handler, req: ChangeRequest): { text: string; summary: string } {
  const id = changeId(req);
  const errors = req.action === 'delete' ? [] : h.validate(req.action, req.spec ?? {});
  if (errors.length) throw new ChangeError(422, 'The change is not valid.', errors);
  const fresh = text.trim() === '';
  const doc = parse(text);
  if (doc.contents === null) doc.contents = doc.createNode({}) as typeof doc.contents;
  const touched = untouched();
  h.apply(doc, { ...req, id }, touched);
  const verb = { create: 'Add', update: 'Change', delete: 'Remove' }[req.action];
  const owner = req.owner.kind === 'application' ? req.owner.name : 'the platform';
  // a file that does not exist yet (the first object of the platform of a service) is written whole
  const out = fresh ? `${NEW_FILE_HEADER}\n${doc.toString({ lineWidth: 0 })}` : splice(text, touched);
  return { text: out, summary: `${verb} ${h.label} ${id} of ${owner}` };
}

/** A line-by-line diff of two texts, enough to show a change before its pull request (- old, + new). */
export function lineDiff(a: string, b: string): string {
  const x = a.split('\n');
  const y = b.split('\n');
  let s = 0;
  while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let e = 0;
  while (e < x.length - s && e < y.length - s && x[x.length - 1 - e] === y[y.length - 1 - e]) e++;
  const ctx = (l: string[]) => l.map(t => `  ${t}`);
  return [
    ...ctx(x.slice(Math.max(0, s - 2), s)),
    ...x.slice(s, x.length - e).map(t => `- ${t}`),
    ...y.slice(s, y.length - e).map(t => `+ ${t}`),
    ...ctx(x.slice(x.length - e, x.length - e + 2)),
  ].join('\n');
}

// ---- the handlers of the blocks s3 and dms (the other services register theirs the same way)

/** The names of buckets and sites, as the charts of the applications check them (3 to 30 characters). */
export const BLOCK_NAME = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const checkName = (spec: Record<string, unknown>, what: string) => {
  const n = str(spec.name);
  return n && BLOCK_NAME.test(n) ? [] : [`${what}: lowercase letters, digits and "-", 3 to 30 characters.`];
};

registerHandler({
  service: 'seaweedfs',
  object: 'bucket',
  label: 'S3 bucket',
  target: appOrPlatform('seaweedfs'),
  validate: (action, spec) => [
    ...(action === 'create' ? checkName(spec, 'The name of the bucket') : []),
    ...['writeGroup', 'readGroup'].filter(k => spec[k] !== undefined && typeof spec[k] !== 'string').map(k => `${k}: a Keycloak group.`),
  ],
  apply: (doc, req, touched) => {
    // a bucket of the platform: manage.buckets of seaweedfs (its groups of writers and readers)
    if (req.owner.kind === 'platform') {
      editList(doc, platformList(doc, 'buckets', touched), req.action, req.id, { writeGroup: req.spec?.writeGroup, readGroup: req.spec?.readGroup }, false);
      return;
    }
    const b = block(doc, 's3', touched);
    editList(doc, list(doc, b, 'buckets', touched), req.action, req.id, {}, true);
  },
  declared: (doc, owner) => entriesOf(doc, owner.kind === 'platform' ? ['manage', 'buckets'] : ['platform', 's3', 'buckets']),
});

registerHandler({
  service: 'alfresco',
  object: 'site',
  label: 'document site',
  target: appOrPlatform('alfrescodms'),
  validate: (action, spec) => [
    ...(action === 'create' ? checkName(spec, 'The name of the site') : []),
    ...(spec.users !== undefined && !strList(spec.users) ? ['users: a list of user names.'] : []),
    ...(spec.groups !== undefined && !strList(spec.groups) ? ['groups: a list of Keycloak groups.'] : []),
  ],
  apply: (doc, req, touched) => {
    const fields = { users: req.spec?.users, groups: req.spec?.groups };
    if (req.owner.kind === 'platform') {
      editList(doc, platformList(doc, 'sites', touched), req.action, req.id, fields, false);
      return;
    }
    editList(doc, list(doc, block(doc, 'dms', touched), 'sites', touched), req.action, req.id, fields, false);
  },
  declared: (doc, owner) => entriesOf(doc, owner.kind === 'platform' ? ['manage', 'sites'] : ['platform', 'dms', 'sites']),
});
