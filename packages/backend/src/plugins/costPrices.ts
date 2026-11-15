import { parse } from 'yaml';

/**
 * The prices of the platform (FinOps › Prices of the console): what is under `opencost.pricing` in the values of the
 * chart cnoe-oneke (refresquito-services), read from the repository and changed with a pull request.
 *
 * A price is named by its path under `opencost.pricing`: `cpuPerCoreHour`, `network.internetEgressPerGiB`,
 * `perIncident.P1`. The price of an assistant is `assistants.<model>[@<runner>].<field>` (the entry of the list
 * whose model, and runner when it has one, are those).
 *
 * The values file is changed line by line, never rewritten: its comments and its layout stay, and the diff of the pull
 * request is only the prices. A change of the chart needs its version raised, its entry in CHANGELOG.md and the two
 * files `bootstrap/gen-techdocs.py` writes (docs/index.md, chart-versions.yaml): the pull request carries the five.
 */
export class PriceError extends Error {}

export type PriceValue = number | string;
export type Prices = Record<string, PriceValue>;

type Kind = 'money' | 'percent' | 'nodeLabel' | 'labelName';
const FIXED: Record<string, Kind> = {
  cpuPerCoreHour: 'money',
  ramPerGiBHour: 'money',
  storagePerGiBHour: 'money',
  gpuPerHour: 'money',
  gpuNodeLabel: 'labelName',
  'spot.cpuPerCoreHour': 'money',
  'spot.ramPerGiBHour': 'money',
  'spot.nodeLabel': 'nodeLabel',
  'network.zoneEgressPerGiB': 'money',
  'network.regionEgressPerGiB': 'money',
  'network.internetEgressPerGiB': 'money',
  'network.gatewayEgressPerGiB': 'money',
  'network.gatewayIngressPerGiB': 'money',
  'loadBalancer.perHour': 'money',
  'discount.sustainedUse': 'percent',
  'discount.negotiated': 'percent',
  'protection.snapshotPerGiBMonth': 'money',
  'protection.backupPerGiBMonth': 'money',
  perDeployment: 'money',
  'perIncident.P1': 'money',
  'perIncident.P2': 'money',
  'perIncident.P3': 'money',
  'perIncident.P4': 'money',
};
const ASSISTANT_FIELDS = ['inputPerMillion', 'outputPerMillion', 'cacheReadPerMillion', 'cacheWritePerMillion', 'perHour'];
const ASSISTANT = new RegExp(`^assistants\\.[^.@\\s]+(@[a-z0-9-]+)?\\.(${ASSISTANT_FIELDS.join('|')})$`);
const MAX_CHANGES = 60;

/** What kind of value a price is; undefined for a path that is not a price. */
export function kindOf(path: string): Kind | undefined {
  if (path in FIXED) return FIXED[path];
  return ASSISTANT.test(path) ? 'money' : undefined;
}

/** A number as the values file writes it: plain decimals, never an exponent. */
export function numberText(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

/** The key of an entry of `assistants`: its model, and `@runner` when it names one. */
export const assistantKey = (a: { model?: unknown; runner?: unknown }) => `${String(a.model ?? '')}${a.runner ? `@${String(a.runner)}` : ''}`;

/** The prices of a values file, by path; {} when it has no `opencost.pricing`. */
export function readPrices(valuesText: string): { prices: Prices; currency: string; description: string } {
  const pricing = (parse(valuesText) as any)?.opencost?.pricing ?? {};
  const prices: Prices = {};
  const walk = (node: unknown, at: string) => {
    if (typeof node === 'number' || typeof node === 'string') {
      if (kindOf(at)) prices[at] = node;
    } else if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) walk(v, at ? `${at}.${k}` : k);
    }
  };
  for (const [k, v] of Object.entries(pricing)) {
    if (k === 'assistants' && Array.isArray(v)) {
      for (const a of v) {
        for (const f of ASSISTANT_FIELDS) if (typeof a?.[f] === 'number') prices[`assistants.${assistantKey(a)}.${f}`] = a[f];
      }
    } else walk(v, k);
  }
  return { prices, currency: String(pricing.currency ?? 'EUR'), description: String(pricing.description ?? '') };
}

/** The changes of a request checked: every path a price, every value of its kind. */
export function readChanges(body: unknown): Prices {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PriceError('changes is an object: the path of each price and its new value.');
  const entries = Object.entries(body as Record<string, unknown>);
  if (!entries.length) throw new PriceError('No price changes.');
  if (entries.length > MAX_CHANGES) throw new PriceError(`At most ${MAX_CHANGES} prices in one change.`);
  const out: Prices = {};
  for (const [path, v] of entries) {
    const kind = kindOf(path);
    if (!kind) throw new PriceError(`${path} is not a price.`);
    if (kind === 'money' || kind === 'percent') {
      const max = kind === 'percent' ? 100 : 1_000_000;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throw new PriceError(`${path} is a number from 0 to ${max}.`);
      out[path] = v;
    } else {
      const ok = kind === 'nodeLabel' ? /^$|^[A-Za-z0-9][A-Za-z0-9./_-]{0,120}=[A-Za-z0-9._-]{0,63}$/ : /^$|^[A-Za-z0-9][A-Za-z0-9./_-]{0,120}$/;
      if (typeof v !== 'string' || !ok.test(v)) throw new PriceError(kind === 'nodeLabel' ? `${path} is a node label and its value, "label=value", or empty.` : `${path} is the name of a node label, or empty.`);
      out[path] = v;
    }
  }
  return out;
}

type Found = { line: number; start: number; end: number };

/** Where the scalar of each price is in the text of the values file (line and columns of the value). */
function locate(lines: string[]): Map<string, Found> {
  const found = new Map<string, Found>();
  const top = lines.findIndex(l => /^opencost:\s*(#.*)?$/.test(l));
  if (top < 0) return found;
  let i = top + 1;
  while (i < lines.length && !/^ {2}pricing:\s*(#.*)?$/.test(lines[i])) {
    if (/^\S/.test(lines[i])) return found;
    i += 1;
  }
  if (i >= lines.length) return found;
  const indentOf = (l: string) => l.length - l.trimStart().length;
  const stack: Array<{ indent: number; key: string }> = [];
  // the entries of `assistants`, known by model and runner once the whole entry is read
  let item: { indent: number; fields: Map<string, Found>; model?: string; runner?: string } | undefined;
  const closeItem = () => {
    if (item?.model !== undefined) for (const [f, where] of item.fields) found.set(`assistants.${assistantKey(item)}.${f}`, where);
    item = undefined;
  };
  const scalar = (text: string) => text.replace(/^["']|["']$/g, '');
  for (i += 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = indentOf(line);
    if (indent <= 2) break;
    const m = /^(\s*)(- )?([A-Za-z0-9_]+):(\s*)(.*)$/.exec(line);
    if (!m) continue;
    const dash = Boolean(m[2]);
    const keyIndent = indent + (dash ? 2 : 0);
    const valueStart = m[1].length + (dash ? 2 : 0) + m[3].length + 1 + m[4].length;
    // the value ends where its comment starts (a quoted value may hold a #)
    const rest = m[5];
    const v = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^#\s][^#]*?)?(\s+#.*|\s*)$/.exec(rest);
    const value = v?.[1] ?? '';
    const where: Found = { line: i, start: valueStart, end: valueStart + value.length };
    if (item && (dash || keyIndent <= item.indent)) closeItem();
    while (stack.length && stack[stack.length - 1].indent >= (dash ? indent : keyIndent)) stack.pop();
    const parent = stack.map(s => s.key).join('.');
    if (dash) {
      if (parent !== 'assistants') continue;
      item = { indent, fields: new Map() };
    }
    if (item) {
      if (m[3] === 'model') item.model = scalar(value);
      else if (m[3] === 'runner') item.runner = scalar(value);
      else if (value) item.fields.set(m[3], where);
      continue;
    }
    if (value) found.set(parent ? `${parent}.${m[3]}` : m[3], where);
    else stack.push({ indent: keyIndent, key: m[3] });
  }
  closeItem();
  return found;
}

const without = (doc: any) => {
  const copy = JSON.parse(JSON.stringify(doc ?? {}));
  if (copy.opencost) delete copy.opencost.pricing;
  return JSON.stringify(copy);
};

/**
 * The values file with the prices changed, and what really changes (a price given its own value is left out).
 * Throws when a price is not in the file (an older chart), or when the result is not exactly the change asked.
 */
export function withPrices(valuesText: string, changes: Prices): { text: string; changed: Array<{ path: string; from: PriceValue; to: PriceValue }> } {
  const before = readPrices(valuesText).prices;
  const lines = valuesText.split('\n');
  const where = locate(lines);
  const changed: Array<{ path: string; from: PriceValue; to: PriceValue }> = [];
  for (const [path, to] of Object.entries(changes)) {
    const at = where.get(path);
    if (!(path in before) || !at) throw new PriceError(`${path} is not in the values of the chart: it needs a chart that has that price.`);
    if (before[path] === to) continue;
    const text = typeof to === 'number' ? numberText(to) : JSON.stringify(to);
    lines[at.line] = `${lines[at.line].slice(0, at.start)}${text}${lines[at.line].slice(at.end)}`;
    changed.push({ path, from: before[path], to });
  }
  if (!changed.length) throw new PriceError('Every price already has that value.');
  const text = lines.join('\n');
  // the safety net of an edit by lines: read again, the prices are the ones asked and nothing else moved
  const after = readPrices(text).prices;
  const wanted: Prices = { ...before };
  for (const c of changed) wanted[c.path] = c.to;
  if (JSON.stringify(after) !== JSON.stringify(wanted) || without(parse(text)) !== without(parse(valuesText))) {
    throw new PriceError('The values file could not be changed safely: change the prices in the repository.');
  }
  return { text, changed };
}

/** The next patch version of a chart: 0.2.119 → 0.2.120. */
export function nextVersion(chartText: string): { version: string; next: string; text: string } {
  const m = /^version:\s*"?(\d+)\.(\d+)\.(\d+)"?\s*$/m.exec(chartText);
  if (!m) throw new PriceError('The version of the chart could not be read.');
  const version = `${m[1]}.${m[2]}.${m[3]}`;
  const next = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
  return { version, next, text: chartText.replace(m[0], `version: ${next}`) };
}

/** What changes, one line each, as the release notes and the pull request say it. */
export function changeLines(changed: Array<{ path: string; from: PriceValue; to: PriceValue }>, currency: string): string[] {
  const show = (path: string, v: PriceValue) => {
    if (typeof v === 'string') return v ? `\`${v}\`` : 'none';
    return kindOf(path) === 'percent' ? `${numberText(v)} %` : `${numberText(v)} ${currency}`;
  };
  return changed.map(c => `  - \`${c.path}\`: ${show(c.path, c.from)} → ${show(c.path, c.to)}`);
}

/** CHANGELOG.md with the entry of the new version first. */
export function withChangelog(text: string, version: string, date: string, body: string): string {
  const first = text.search(/^## /m);
  if (first < 0) throw new PriceError('CHANGELOG.md of the chart has no entries.');
  return `${text.slice(0, first)}## ${version} - ${date}\n\n${body}\n\n${text.slice(first)}`;
}

/** docs/index.md as bootstrap/gen-techdocs.py writes it for the new version: the version row and the latest release. */
export function withOverview(text: string, chart: string, version: string, date: string, body: string): string {
  const row = new RegExp(`^(\\| Chart \\| \`charts/${chart}\`, version )\\S+( \\|)$`, 'm');
  const latest = /(^## Latest release\n\n)[\s\S]*?(\n\nEvery version: )/m;
  if (!row.test(text) || !latest.test(text)) throw new PriceError('docs/index.md of the chart is not as gen-techdocs.py writes it.');
  return text.replace(row, `$1${version}$2`).replace(latest, (_all, head: string, tail: string) => `${head}**${version} - ${date}**\n\n${body}${tail}`);
}

/** chart-versions.yaml with the new version of the chart. */
export function withChartVersion(text: string, chart: string, version: string): string {
  const line = new RegExp(`^("${chart}": ")[^"]+(")$`, 'm');
  if (!line.test(text)) throw new PriceError(`chart-versions.yaml does not list ${chart}.`);
  return text.replace(line, `$1${version}$2`);
}

export type PriceFiles = { values: string; chart: string; changelog: string; overview: string; versions: string };
export const pricePaths = (chart: string): Record<keyof PriceFiles, string> => ({
  values: `charts/${chart}/values.yaml`,
  chart: `charts/${chart}/Chart.yaml`,
  changelog: `charts/${chart}/CHANGELOG.md`,
  overview: `charts/${chart}/docs/index.md`,
  versions: 'bootstrap/app-of-apps/files/chart-versions.yaml',
});

/** The five files of the change, and the title and text of its pull request. */
export function priceChange(files: PriceFiles, changes: Prices, opts: { chart: string; by: string; date: string }) {
  const { currency } = readPrices(files.values);
  const { text: values, changed } = withPrices(files.values, changes);
  const { version, next, text: chart } = nextVersion(files.chart);
  const lines = changeLines(changed, currency);
  const entry = [`- **Prices** changed from the console (FinOps › Prices) by ${opts.by}:`, ...lines].join('\n');
  const paths = pricePaths(opts.chart);
  return {
    version,
    next,
    changed,
    title: `${opts.chart} ${next}: ${changed.length === 1 ? `price ${changed[0].path}` : `${changed.length} prices`}`,
    body: [
      `Prices of the platform changed from the console (FinOps › Prices) by ${opts.by}.`,
      '',
      ...lines.map(l => l.slice(2)),
      '',
      `Chart \`${opts.chart}\` ${version} → ${next}. Nothing is charged differently until this is merged and the chart is deployed (OpenCost restarts once and takes the prices).`,
      'Resources of the cluster (CPU, memory, disk, GPU, network, load balancers) are charged at the new price from then on. Deployments, incidents and assistants are counted by the console and multiplied by the price in force, so their past months change too.',
    ].join('\n'),
    files: [
      { path: paths.values, text: values },
      { path: paths.chart, text: chart },
      { path: paths.changelog, text: withChangelog(files.changelog, next, opts.date, entry) },
      { path: paths.overview, text: withOverview(files.overview, opts.chart, next, opts.date, entry) },
      { path: paths.versions, text: withChartVersion(files.versions, opts.chart, next) },
    ],
  };
}
