import { isMap, isSeq } from 'yaml';
import { changeBlock, declaredBlock } from './manageBlocks';
import { appFile, ChangeError, registerHandler } from './manageModel';

/**
 * Manage › Business process (Operaton, operaton-oneke: the open-source fork of Camunda 7). The processes of an
 * application come from its image (platform/processes/*.bpmn): Manage turns its block processes on, changes the
 * Keycloak groups that may start them and work their tasks in Tasklist, or retires it (the block's tombstone: its
 * deployments, grants and identity are removed by the provisioner, never while instances are still running).
 * A group taken out of the list is kept as a tombstone `{ name, state: absent }`, so the provisioner takes its grants away.
 */

const GROUP = /^\/?[A-Za-z0-9][A-Za-z0-9._/-]{1,126}$/;
const nameOf = (g: unknown) => {
  if (typeof g === 'string') return g;
  return g && typeof g === 'object' ? String((g as { name?: unknown }).name ?? '') : '';
};
const isGone = (g: unknown) => !!g && typeof g === 'object' && (g as { state?: unknown }).state === 'absent';

/** The new list of groups: the ones given, and a tombstone for each one that was there and is not any more. */
export function groupsWithTombstones(current: unknown[], wanted: string[]): unknown[] {
  const live = current.filter(g => !isGone(g)).map(nameOf).filter(Boolean);
  const before = current.filter(g => isGone(g) && !wanted.includes(nameOf(g)));
  const removed = live.filter(g => !wanted.includes(g)).map(name => ({ name, state: 'absent' }));
  return [...wanted, ...before, ...removed];
}

registerHandler({
  service: 'processes',
  object: 'processes',
  label: 'business processes',
  target: appFile,
  validate: (_action, spec) => {
    const groups = spec.groups;
    if (groups === undefined) return [];
    if (!Array.isArray(groups) || !groups.every(g => typeof g === 'string')) return ['groups: a list of Keycloak groups.'];
    return groups.filter(g => !GROUP.test(String(g))).map(g => `groups: "${String(g)}" is not the name or /path of a group.`);
  },
  apply: (doc, req, touched) => {
    const s = req.spec ?? {};
    let groups: unknown[] | undefined;
    if (Array.isArray(s.groups)) {
      const b = doc.getIn(['platform', 'processes']);
      const cur = isMap(b) ? b.get('groups') : undefined;
      groups = groupsWithTombstones(isSeq(cur) ? (cur.toJSON() as unknown[]) : [], (s.groups as string[]).map(g => g.trim()).filter(Boolean));
    }
    if (req.action === 'update' && groups === undefined) throw new ChangeError(422, 'Nothing to change: the processes themselves come from the image of the application.');
    changeBlock(doc, 'processes', req.action, req.id, req.owner, { groups }, touched);
  },
  declared: doc =>
    declaredBlock(doc, 'processes', b => ({ groups: (Array.isArray(b.groups) ? b.groups : []).filter(g => !isGone(g)).map(nameOf) })),
});
