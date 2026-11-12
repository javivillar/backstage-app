import { managersOf } from '@internal/backstage-plugin-portal-access-common';
import { stringify } from 'yaml';

/**
 * Continuity exercises of the business map: the matrix of the console (Portal > Business map > Matrix) lets a business
 * architect fail some platform or development services ("what if this fails?") and see which business processes
 * still meet their RTO and by how much; "Save as exercise" keeps that result as a file in refresquito-specs
 * (continuity/exercises/<namespace>/<yyyy-mm-dd>-<slug>.yaml) through a pull request, so the exercises a customer
 * ran are reviewed and kept with its specifications. The pure parts here, the route in exercisesRouter.ts.
 */

export type ExerciseProcess = { ref: string; result: string; marginMinutes?: number | null };
export type Exercise = { namespace: string; failed: string[]; processes: ExerciseProcess[]; note?: string };

/** A bad request body (400). */
export class ExerciseError extends Error {}

export const EXERCISE_NAMESPACE = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const REF = /^[a-z0-9]+:[a-z0-9._-]+\/[a-z0-9._-]+$/i;
const RESULT = /^[a-z][a-z-]{0,31}$/;
const MAX_FAILED = 50;
const MAX_PROCESSES = 1000;

/** The groups that may change the business map: who manages the area `business` of the table of permissions of the portal, and console.actions.groups. */
export function writers(actionGroups?: string[]): string[] {
  return [...new Set([...managersOf('business'), ...(actionGroups ?? [])])];
}

/** The body of POST /exercises checked: anything else is an ExerciseError. Refs are lowercased. */
export function readExercise(body: unknown): Exercise {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.namespace !== 'string' || !EXERCISE_NAMESPACE.test(b.namespace)) throw new ExerciseError('namespace is a namespace (lowercase letters, digits and "-").');
  if (!Array.isArray(b.failed) || !b.failed.length || b.failed.length > MAX_FAILED) throw new ExerciseError(`failed is a list of 1 to ${MAX_FAILED} entity references.`);
  const failed = b.failed.map(r => {
    if (typeof r !== 'string' || !REF.test(r)) throw new ExerciseError(`${String(r)} in failed is not an entity reference (kind:namespace/name).`);
    return r.toLowerCase();
  });
  if (!Array.isArray(b.processes) || b.processes.length > MAX_PROCESSES) throw new ExerciseError(`processes is a list of up to ${MAX_PROCESSES} { ref, result, marginMinutes }.`);
  const processes = b.processes.map((x): ExerciseProcess => {
    const p = (x ?? {}) as Record<string, unknown>;
    if (typeof p.ref !== 'string' || !REF.test(p.ref)) throw new ExerciseError(`${String(p.ref)} in processes is not an entity reference (kind:namespace/name).`);
    if (typeof p.result !== 'string' || !RESULT.test(p.result)) throw new ExerciseError(`The result of ${p.ref} is a word (e.g. meets, gap, down).`);
    const m = p.marginMinutes;
    if (m !== undefined && m !== null && (typeof m !== 'number' || !Number.isFinite(m))) throw new ExerciseError(`The marginMinutes of ${p.ref} is a number.`);
    return { ref: p.ref.toLowerCase(), result: p.result, marginMinutes: typeof m === 'number' ? m : null };
  });
  if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') throw new ExerciseError('note is a text.');
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 2000) : undefined;
  return { namespace: b.namespace, failed: [...new Set(failed)], processes, ...(note ? { note } : {}) };
}

const nameOf = (ref: string) => ref.slice(ref.lastIndexOf('/') + 1);

/** The slug of an exercise: what failed, e.g. fail-postgres-keycloak, at most 60 characters. */
export function exerciseSlug(e: Pick<Exercise, 'failed'>): string {
  const words = `fail-${e.failed.map(nameOf).join('-')}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return words.slice(0, 60).replace(/-+$/, '') || 'fail';
}

/** The file of an exercise in refresquito-specs; n > 1 for the second and later exercise of that slug on that day. */
export function exercisePath(e: Pick<Exercise, 'namespace' | 'failed'>, date: string, n = 1): string {
  return `continuity/exercises/${e.namespace}/${date}-${exerciseSlug(e)}${n > 1 ? `-${n}` : ''}.yaml`;
}

/** How many processes of each result, e.g. { gap: 2, meets: 5 }, sorted by result. */
export function resultCounts(processes: ExerciseProcess[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of processes) counts[p.result] = (counts[p.result] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

const HEADER = [
  '# A continuity exercise of the business map: in the matrix of the console (Portal > Business map > Matrix) the',
  '# services under "failed" were made to fail, and "processes" is what that did to each business process of the',
  '# customer (its result and the minutes of margin left against its RTO; negative: over it). Saved from the console',
  '# ("Save as exercise") through a pull request; it records a desk exercise, it changes nothing in the platform.',
].join('\n');

/** The YAML of an exercise: the header above, then the exercise, the processes strictest margin first. */
export function exerciseYaml(e: Exercise, o: { date: string; by: string }): string {
  const processes = [...e.processes].sort((a, b) => (a.marginMinutes ?? Infinity) - (b.marginMinutes ?? Infinity) || a.ref.localeCompare(b.ref));
  const doc = {
    apiVersion: 'refresquito.io/v1alpha1',
    kind: 'ContinuityExercise',
    metadata: { name: `${o.date}-${exerciseSlug(e)}`, namespace: e.namespace },
    spec: {
      date: o.date,
      by: o.by,
      ...(e.note ? { note: e.note } : {}),
      failed: e.failed,
      summary: resultCounts(e.processes),
      processes: processes.map(p => ({ ref: p.ref, result: p.result, marginMinutes: p.marginMinutes ?? null })),
    },
  };
  return `${HEADER}\n${stringify(doc, { lineWidth: 0 })}`;
}

/** The title and body of the pull request of an exercise. */
export function exercisePull(e: Exercise, o: { date: string; by: string; path: string }): { title: string; body: string } {
  const counts = Object.entries(resultCounts(e.processes)).map(([r, n]) => `${n} ${r}`);
  const shown = e.failed.slice(0, 3).map(nameOf).join(', ') + (e.failed.length > 3 ? ` and ${e.failed.length - 3} more` : '');
  return {
    title: `Continuity exercise ${e.namespace}: fail ${shown}`,
    body: [
      `Continuity exercise of **${e.namespace}** saved from the console (Business map > Matrix) by \`${o.by}\` on ${o.date}.`,
      e.note ? `\n> ${e.note.replace(/\n/g, '\n> ')}` : '',
      `\n**Failed:** ${e.failed.map(r => `\`${r}\``).join(', ')}`,
      `\n**Processes:** ${counts.length ? counts.join(', ') : 'none affected'}`,
      `\nFile: \`${o.path}\`. A desk exercise: merging it keeps the record, it changes nothing in the platform.`,
    ].join('\n'),
  };
}
