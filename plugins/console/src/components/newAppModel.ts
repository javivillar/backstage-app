/**
 * The model of Development › New application: everything comes from the template of the catalog (its steps, fields,
 * enums and patterns), so a new line of a framework, or a new framework, shows up without changing the console.
 */
export type Prop = {
  title?: string;
  description?: string;
  type?: string;
  enum?: string[];
  enumNames?: string[];
  default?: unknown;
  pattern?: string;
  items?: { type?: string; enum?: string[]; pattern?: string };
  minItems?: number;
};
export type Step = { title: string; description?: string; properties: Record<string, Prop>; required: string[] };
export type Values = Record<string, unknown>;

export function stepsOf(template: { spec?: { parameters?: unknown } }): Step[] {
  const raw = template.spec?.parameters;
  const list = (Array.isArray(raw) ? raw : [raw]).filter(Boolean) as Array<Record<string, any>>;
  return list.map(s => ({ title: String(s.title ?? ''), description: s.description, properties: (s.properties ?? {}) as Record<string, Prop>, required: (s.required ?? []) as string[] }));
}

export function defaultsOf(steps: Step[]): Values {
  const v: Values = {};
  for (const s of steps)
    for (const [k, p] of Object.entries(s.properties)) {
      if (p.default !== undefined) v[k] = p.default;
      else if (p.type === 'array') v[k] = [];
      else if (p.type === 'boolean') v[k] = false;
      else v[k] = '';
    }
  return v;
}

/** "3.3 (refresquito-fastapi 3.3.0, refresquito-angular 3.3.1) - the look of Refresquito" → its parts */
export type Line = { value: string; releases: Array<{ name: string; version: string }>; what: string; label: string };
export function linesOf(p?: Prop): Line[] {
  return (p?.enum ?? []).map((value, i) => {
    const label = p?.enumNames?.[i] ?? value;
    const m = /^\S+\s*(?:\(([^)]*)\))?\s*(?:-\s*(.*))?$/.exec(label);
    const releases = (m?.[1] ?? '')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => {
        const [name, version] = x.split(/\s+/);
        return { name, version: version ?? '' };
      });
    return { value, releases, what: m?.[2] ?? '', label };
  });
}

/** the problems of one step: required fields, patterns (strings and items of arrays), minimum items */
export function problemsOf(step: Step, v: Values): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, p] of Object.entries(step.properties)) {
    const val = v[k];
    if (step.required.includes(k) && (val === undefined || val === '' || (Array.isArray(val) && !val.length))) {
      out[k] = 'Required.';
      continue;
    }
    if (typeof val === 'string' && val && p.pattern && !new RegExp(p.pattern).test(val)) out[k] = `Not valid: it must match ${p.pattern}.`;
    if (Array.isArray(val)) {
      if (p.minItems && val.length < p.minItems) out[k] = `Choose at least ${p.minItems}.`;
      const bad = p.items?.pattern ? val.filter(x => typeof x === 'string' && x && !new RegExp(p.items!.pattern!).test(x)) : [];
      if (bad.length) out[k] = `Not valid: ${bad.join(', ')}.`;
      if (new Set(val).size !== val.length) out[k] = 'Each one only once.';
    }
  }
  return out;
}

/** what is sent: empty rows of the lists dropped */
export function cleanValues(steps: Step[], v: Values): Values {
  const out: Values = {};
  for (const s of steps)
    for (const k of Object.keys(s.properties)) {
      const val = v[k];
      out[k] = Array.isArray(val) ? val.filter(x => x !== '' && x !== undefined) : val;
    }
  return out;
}

/**
 * The platform blocks: a switch (a boolean of the template, or a list that is the block itself), and the fields that
 * belong to it. Fields of the template not named here are shown as they are, after the blocks.
 */
export type Block = { id: string; label: string; product: string; toggle?: string; list?: string; fields: string[] };
export const BLOCKS: Block[] = [
  { id: 'sso', label: 'Single sign-on', product: 'Keycloak', toggle: 'sso', fields: ['admins'] },
  { id: 'monitoring', label: 'Monitoring', product: 'Prometheus · Grafana', toggle: 'monitoring', fields: [] },
  { id: 'datahub', label: 'Data catalogue', product: 'DataHub', toggle: 'datahub', fields: ['dataClassification', 'dataReleasability', 'dataOwners', 'dataOwnerGroups'] },
  { id: 'gateway', label: 'API gateway', product: 'Gravitee', toggle: 'gateway', fields: ['gatewayTeam'] },
  { id: 's3', label: 'Object storage', product: 'SeaweedFS · S3', list: 's3Buckets', fields: ['s3Buckets'] },
  { id: 'dms', label: 'Documents', product: 'Alfresco', list: 'dmsSites', fields: ['dmsSites', 'dmsGroups'] },
  { id: 'processes', label: 'Business processes', product: 'Camunda', toggle: 'processes', fields: ['processGroups'] },
  { id: 'dashboards', label: 'Business intelligence', product: 'Superset', toggle: 'dashboards', fields: [] },
  { id: 'flows', label: 'Workflow integration', product: 'Activepieces', toggle: 'flows', fields: ['flowGroups'] },
];
export const blockFields = new Set(BLOCKS.flatMap(b => [b.toggle, ...b.fields].filter(Boolean) as string[]));

/** lists whose items become <name>-<item> in the platform */
export const PREFIXED = new Set(['s3Buckets', 'dmsSites']);

export type TaskEvent = { id: number; type: string; body: { message?: string; stepId?: string; status?: string; output?: Record<string, unknown> }; createdAt?: string };
/** the state of each step of a running task, from its events */
export function stepStates(events: TaskEvent[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of events) if (e.body.stepId && e.body.status) m.set(e.body.stepId, e.body.status);
  return m;
}
