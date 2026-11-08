/**
 * The form field BusinessModelPreview of the template Import business model (backstage-templates): it sends the
 * values of the form to POST /api/business-map/import/preview (packages/backend businessMap/previewRouter.ts, the
 * same as the action refresquito:business-model:preview) and shows what the import would do. Its value in the form
 * is a short summary, so the validation of the field can stop Next while the file has errors, unless the rows with
 * errors are skipped. The pure parts are here; the component in BusinessModelPreview.tsx.
 */

export type Issue = { row?: number; message: string };
export type Change = { kind: 'new' | 'changed' | 'review'; id: string; title: string; what: string };
export type Counts = { domains: number; subdomains: number; new: number; changed: number; gone: number; unchanged: number };
export type Preview = { counts: Counts; errors: Issue[]; warnings: Issue[]; changes: Change[] };

/** The body of the preview route: the values of the form the action reads. */
export type PreviewBody = {
  source: string;
  file: string;
  namespace: string;
  fileName?: string;
  sheet?: string | number;
  owner?: string;
  mapping?: Record<string, unknown>;
  valueMapping?: Record<string, unknown>;
  keepFrom?: string;
  industry?: string;
  version?: string;
};

/** The value of the field in the form (also sent to the task as parameters.preview: keep it small). */
export type PreviewValue = {
  state: 'loading' | 'done' | 'failed';
  /** which input it is the preview of (previewKey) */
  key: string;
  errors?: number;
  warnings?: number;
  message?: string;
};

const OPTIONAL = ['fileName', 'owner', 'keepFrom', 'industry', 'version'] as const;

/** The body for the values of the form, or what is still missing to ask for a preview. */
export function previewRequest(form: Record<string, unknown> | undefined): { body?: PreviewBody; missing?: string } {
  const f = form ?? {};
  const missing = (['source', 'file', 'namespace'] as const).filter(k => typeof f[k] !== 'string' || !f[k]);
  if (missing.length) return { missing: missing.join(', ') };
  const body: PreviewBody = { source: f.source as string, file: f.file as string, namespace: f.namespace as string };
  for (const k of OPTIONAL) if (typeof f[k] === 'string' && f[k]) body[k] = f[k] as string;
  if ((typeof f.sheet === 'string' && f.sheet) || typeof f.sheet === 'number') body.sheet = f.sheet as string | number;
  // the mapping and value mapping only count for an own layout (the form keeps them if the source changed after)
  if (body.source === 'own') {
    if (f.mapping && typeof f.mapping === 'object') body.mapping = f.mapping as Record<string, unknown>;
    if (f.valueMapping && typeof f.valueMapping === 'object') body.valueMapping = f.valueMapping as Record<string, unknown>;
  }
  return { body };
}

/** A short fingerprint of a request: the file by its length and end (a data URL of MB), the rest as it is. */
export function previewKey(body: PreviewBody): string {
  const { file, ...rest } = body;
  const others: Record<string, unknown> = rest;
  return `${file.length}:${file.slice(-48)}:${JSON.stringify(Object.keys(others).sort().map(k => [k, others[k]]))}`;
}

/** The value of the field for an answer of the route. */
export function valueOf(key: string, answer: { preview?: Preview; error?: string }): PreviewValue {
  if (!answer.preview) return { state: 'failed', key, message: answer.error ?? 'no answer' };
  return { state: 'done', key, errors: answer.preview.errors.length, warnings: answer.preview.warnings.length };
}

/**
 * Why Next (or Create) cannot go on, or undefined: the preview is not there yet or is of other values, it failed, or
 * the file has errors and skipErrors is not ticked. The import action checks the errors again on the server.
 */
export function blockingMessage(value: PreviewValue | undefined, form: Record<string, unknown> | undefined): string | undefined {
  const { body, missing } = previewRequest(form);
  if (!body) return `The preview needs ${missing}: fill them in on the first page.`;
  if (!value || value.key !== previewKey(body) || value.state === 'loading') return 'The preview is not ready yet: wait for it before going on.';
  if (value.state === 'failed') return `The preview failed (${value.message ?? 'unknown error'}): go back and fix the file or the options.`;
  const errors = value.errors ?? 0;
  if (errors > 0 && form?.skipErrors !== true) {
    return `The file has ${errors} ${errors === 1 ? 'error' : 'errors'}: fix ${errors === 1 ? 'it' : 'them'} and upload the file again, or tick "Skip the rows with errors".`;
  }
  return undefined;
}

export type Card = { value: string; label: string; tone: 'neutral' | 'positive' };

/** The figures of a preview as the cards of the mockup (domains, new, changed, no longer in the file, unchanged). */
export function cardsOf(c: Counts): Card[] {
  return [
    { value: String(c.domains), label: `${c.domains === 1 ? 'domain' : 'domains'} · ${c.subdomains} ${c.subdomains === 1 ? 'subdomain' : 'subdomains'}`, tone: 'neutral' },
    { value: `+ ${c.new}`, label: 'new', tone: c.new ? 'positive' : 'neutral' },
    { value: `~ ${c.changed}`, label: 'changed', tone: 'neutral' },
    { value: `− ${c.gone}`, label: 'no longer in the file: marked for review', tone: 'neutral' },
    { value: String(c.unchanged), label: 'unchanged', tone: 'neutral' },
  ];
}

/** An issue as one line: "Row 41: ..." when it has a row. */
export const issueText = (i: Issue) => (i.row ? `Row ${i.row}: ${i.message}` : i.message);

/** The changes shown in the table: the reviews and changes first (what needs reading), then the new ones; at most n. */
export function shownChanges(changes: Change[], n = 25): { rows: Change[]; total: number } {
  const order: Record<Change['kind'], number> = { review: 0, changed: 1, new: 2 };
  const rows = [...changes].sort((a, b) => order[a.kind] - order[b.kind]).slice(0, n);
  return { rows, total: changes.length };
}
