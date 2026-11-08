/**
 * The fields of a Manage form (ManageForm): each page describes its object with a few fields, and this turns what the
 * person typed into the spec of POST /api/manage/changes, with the checks that can be made in the browser. The backend
 * checks again (manageModel.ts): this only spares a round trip.
 */
export type FieldKind = 'text' | 'list' | 'boolean' | 'select';
export type Field = {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  help?: string;
  /** select: its values (value, label) */
  options?: Array<{ value: string; label: string }>;
  /** text: a regular expression the value must match, with the message when it does not */
  pattern?: { re: RegExp; message: string };
  /** only when creating (the name, for instance: it cannot change afterwards) */
  createOnly?: boolean;
};
export type Values = Record<string, string | boolean>;

/** A list typed as "a, b, c" (or one per line). */
export const splitList = (v: string) =>
  v
    .split(/[,\n]/)
    .map(x => x.trim())
    .filter(Boolean);

/** The initial values of the form: empty, or those of the object being changed. */
export function initialValues(fields: Field[], current?: Record<string, unknown>): Values {
  return Object.fromEntries(
    fields.map(f => {
      const v = current?.[f.key];
      if (f.kind === 'boolean') return [f.key, v === true];
      if (f.kind === 'list') return [f.key, Array.isArray(v) ? v.join(', ') : ''];
      return [f.key, typeof v === 'string' || typeof v === 'number' ? String(v) : ''];
    }),
  );
}

/** What is wrong with the values, by field key. */
export function fieldErrors(fields: Field[], values: Values, creating: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (f.createOnly && !creating) continue;
    const v = values[f.key];
    if (f.kind === 'boolean') continue;
    const s = String(v ?? '').trim();
    if (f.required && !s) out[f.key] = 'required';
    else if (s && f.kind === 'text' && f.pattern && !f.pattern.re.test(s)) out[f.key] = f.pattern.message;
    else if (s && f.kind === 'select' && f.options && !f.options.some(o => o.value === s)) out[f.key] = 'not one of the options';
  }
  return out;
}

/** The spec of the change: lists as arrays, booleans as booleans, empty texts left out; on update only what changed. */
export function specFrom(fields: Field[], values: Values, creating: boolean, current?: Record<string, unknown>): Record<string, unknown> {
  const spec: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.createOnly && !creating) continue;
    const v = values[f.key];
    let out: unknown;
    if (f.kind === 'boolean') out = v === true;
    else if (f.kind === 'list') out = splitList(String(v ?? ''));
    else {
      const s = String(v ?? '').trim();
      out = s === '' ? undefined : s;
    }
    if (out === undefined) continue;
    if (!creating && current && JSON.stringify(current[f.key] ?? (f.kind === 'list' ? [] : f.kind === 'boolean' ? false : undefined)) === JSON.stringify(out)) continue;
    spec[f.key] = out;
  }
  return spec;
}
