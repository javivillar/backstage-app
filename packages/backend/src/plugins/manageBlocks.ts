import { isMap, type Document } from 'yaml';
import { block, ChangeError, type Declared, type ManageAction, type Owner, setIn, type Touched } from './manageModel';

/**
 * The objects of an application that are a whole block of its file, one per application (its gateway API, its data
 * product, its dashboards, the settings of its sign-in client): create turns the block on, update changes its settings
 * in place, delete marks the block `state: absent`, which the provisioner tears down on merge (python-app-oneke
 * INSTALL.md, "Deleting: tombstones"). The id of the object is the name of the application.
 */

const absent = (doc: Document, name: string) => doc.getIn(['platform', name, 'state']) === 'absent';
const present = (doc: Document, name: string) => {
  const b = doc.getIn(['platform', name]);
  return isMap(b) && b.get('enabled') !== false && !absent(doc, name);
};

export function changeBlock(
  doc: Document,
  name: string,
  action: ManageAction,
  id: string,
  owner: Owner,
  fields: Record<string, unknown>,
  touched: Touched,
): void {
  if (owner.kind !== 'application') throw new ChangeError(422, `platform.${name} is a block of an application.`);
  if (id !== owner.name) throw new ChangeError(422, `The ${name} of ${owner.name} is named ${owner.name}.`);
  const on = present(doc, name);
  if (action === 'create' && on) throw new ChangeError(409, `${owner.name} already has its ${name}.`);
  if (action !== 'create' && !on) throw new ChangeError(404, `${owner.name} has no ${name}.`);
  const b = block(doc, name, touched);
  if (action === 'delete') {
    setIn(doc, b, 'state', 'absent', touched);
    return;
  }
  // create on a tombstone revives the block
  if (action === 'create') setIn(doc, b, 'state', undefined, touched);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) setIn(doc, b, k, v, touched);
}

/** The block of the application as Declared (one, or none when the file does not use it). */
export function declaredBlock(doc: Document, name: string, pick: (b: Record<string, unknown>) => Record<string, unknown>): Declared[] {
  const b = doc.getIn(['platform', name]);
  const app = doc.get('name');
  if (!isMap(b) || typeof app !== 'string' || b.get('enabled') === false) return [];
  const json = b.toJSON() as Record<string, unknown>;
  return [{ id: app, spec: { name: app, ...pick(json) }, gone: absent(doc, name) }];
}
