import { configApiRef, discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useCallback, useEffect, useState } from 'react';

/**
 * FinOps › Prices: every price the platform can charge. The prices live under `opencost.pricing` of the chart
 * cnoe-oneke; a price is named by its path there (`cpuPerCoreHour`, `network.internetEgressPerGiB`,
 * `assistants.<model>[@<runner>].<field>`). Two sources: what is deployed (the configuration of this portal) and what
 * is in the repository (backend costs, GET /api/costs/prices), which is what a change is made on.
 */
export type PriceValue = number | string;
export type Prices = Record<string, PriceValue>;
export type PriceKind = 'money' | 'percent' | 'label';
/** use: charged today · set: has a price, charged when what it needs exists · off: no price */
export type PriceState = 'use' | 'set' | 'off';
export type PriceBy = 'opencost' | 'console';
export type GroupId = 'compute' | 'storage' | 'network' | 'loadBalancer' | 'discount' | 'services' | 'assistants';
export type PriceRow = {
  path: string;
  group: GroupId;
  by: PriceBy;
  kind: PriceKind;
  /** message keys, or the text itself for an assistant */
  name: string;
  unit: string;
  note?: string;
  /** the name OpenCost gives it in its price file */
  opencost?: string;
  /** what is charged today (deployed), else what the repository has */
  value?: PriceValue;
  /** what the repository has, when it is not what is deployed */
  pending?: PriceValue;
  /** what a change starts from: the repository */
  base?: PriceValue;
  state: PriceState;
};
/** GET /api/costs/prices */
export type PricesData = { may: boolean; groups: string[]; repo: string; path: string; url: string; version?: string; currency: string; description: string; prices: Prices };
export type PricesAnswer = { pull: { number: number; url: string }; version: string };

type Spec = { path: string; group: GroupId; kind?: PriceKind; opencost?: string; note?: boolean; charged?: boolean };
const SPECS: Spec[] = [
  { path: 'cpuPerCoreHour', group: 'compute', opencost: 'CPU', charged: true },
  { path: 'ramPerGiBHour', group: 'compute', opencost: 'RAM', charged: true },
  { path: 'gpuPerHour', group: 'compute', opencost: 'GPU', note: true },
  { path: 'gpuNodeLabel', group: 'compute', kind: 'label', opencost: 'gpuLabel', note: true },
  { path: 'spot.cpuPerCoreHour', group: 'compute', opencost: 'spotCPU', note: true },
  { path: 'spot.ramPerGiBHour', group: 'compute', opencost: 'spotRAM', note: true },
  { path: 'spot.nodeLabel', group: 'compute', kind: 'label', opencost: 'spotLabel · spotLabelValue', note: true },
  { path: 'storagePerGiBHour', group: 'storage', opencost: 'storage', charged: true },
  { path: 'network.zoneEgressPerGiB', group: 'network', opencost: 'zoneNetworkEgress' },
  { path: 'network.regionEgressPerGiB', group: 'network', opencost: 'regionNetworkEgress' },
  { path: 'network.internetEgressPerGiB', group: 'network', opencost: 'internetNetworkEgress' },
  { path: 'network.gatewayEgressPerGiB', group: 'network', opencost: 'natGatewayEgress' },
  { path: 'network.gatewayIngressPerGiB', group: 'network', opencost: 'natGatewayIngress' },
  { path: 'loadBalancer.perHour', group: 'loadBalancer', opencost: 'firstFiveForwardingRulesCost' },
  { path: 'discount.sustainedUse', group: 'discount', kind: 'percent', opencost: 'discount' },
  { path: 'discount.negotiated', group: 'discount', kind: 'percent', opencost: 'negotiatedDiscount' },
  { path: 'protection.snapshotPerGiBMonth', group: 'services', charged: true },
  { path: 'protection.backupPerGiBMonth', group: 'services', charged: true },
  { path: 'perDeployment', group: 'services', charged: true },
  { path: 'perIncident.P1', group: 'services', charged: true },
  { path: 'perIncident.P2', group: 'services', charged: true },
  { path: 'perIncident.P3', group: 'services', charged: true },
  { path: 'perIncident.P4', group: 'services', charged: true },
];
export const GROUPS: Array<{ id: GroupId; by: PriceBy }> = [
  { id: 'compute', by: 'opencost' },
  { id: 'storage', by: 'opencost' },
  { id: 'network', by: 'opencost' },
  { id: 'loadBalancer', by: 'opencost' },
  { id: 'discount', by: 'opencost' },
  { id: 'services', by: 'console' },
  { id: 'assistants', by: 'console' },
];
const ASSISTANT_FIELDS = ['inputPerMillion', 'outputPerMillion', 'cacheReadPerMillion', 'cacheWritePerMillion', 'perHour'];
const assistantKey = (a: { model?: unknown; runner?: unknown }) => `${String(a.model ?? '')}${a.runner ? `@${String(a.runner)}` : ''}`;

/** The prices of an `opencost.pricing` object (the configuration of the portal), by path. */
export function flatPrices(pricing: unknown): Prices {
  const out: Prices = {};
  const known = new Set(SPECS.map(s => s.path));
  const walk = (node: unknown, at: string) => {
    if (typeof node === 'number' || typeof node === 'string') {
      if (known.has(at)) out[at] = node;
    } else if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) walk(v, at ? `${at}.${k}` : k);
    }
  };
  for (const [k, v] of Object.entries((pricing ?? {}) as Record<string, unknown>)) {
    if (k === 'assistants' && Array.isArray(v)) {
      for (const a of v as Array<Record<string, unknown>>) {
        for (const f of ASSISTANT_FIELDS) if (typeof a?.[f] === 'number') out[`assistants.${assistantKey(a)}.${f}`] = a[f] as number;
      }
    } else walk(v, k);
  }
  return out;
}

const isSet = (v: PriceValue | undefined) => (typeof v === 'number' ? v > 0 : Boolean(v));
/** charged: what the platform charges whenever it has a price (CPU, an incident); the rest needs something more. */
function stateOf(charged: boolean, value: PriceValue | undefined): PriceState {
  if (charged && value !== undefined) return 'use';
  return isSet(value) ? 'set' : 'off';
}

/** Every price, in the order of the page: the fixed ones and one per field of each assistant model. */
export function priceRows(deployed: Prices, repo?: Prices): PriceRow[] {
  const row = (s: Spec & { name: string; unit: string }): PriceRow => {
    const live = deployed[s.path];
    const base = repo?.[s.path];
    const value = live ?? base;
    const by = GROUPS.find(g => g.id === s.group)!.by;
    return {
      path: s.path, group: s.group, by, kind: s.kind ?? 'money', name: s.name, unit: s.unit, note: s.note ? `price.note.${s.path}` : undefined, opencost: s.opencost,
      value, base, pending: live !== undefined && base !== undefined && base !== live ? base : undefined,
      state: stateOf(Boolean(s.charged), value),
    };
  };
  const fixed = SPECS.map(s => row({ ...s, name: `price.name.${s.path}`, unit: `price.unit.${s.path}` }));
  const assistants = [...new Set([...Object.keys(deployed), ...Object.keys(repo ?? {})].filter(p => p.startsWith('assistants.')))].map(path => {
    const field = path.slice(path.lastIndexOf('.') + 1);
    const model = path.slice('assistants.'.length, path.lastIndexOf('.'));
    return row({ path, group: 'assistants', charged: true, name: `${model} · price.field.${field}`, unit: `price.unit.${field}` });
  });
  return [...fixed, ...assistants];
}

/** Whether a row matches the text typed: its name, unit, path, OpenCost name or group, anywhere. */
export function matches(texts: string[], query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || texts.some(t => t.toLowerCase().includes(q));
}

/** What was typed as a value of that kind; undefined when it is not one. Takes a comma or a point for decimals. */
export function parsePrice(kind: PriceKind, text: string): PriceValue | undefined {
  const t = text.trim();
  if (kind === 'label') return t;
  if (!/^\d+([.,]\d+)?$/.test(t)) return undefined;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n <= (kind === 'percent' ? 100 : 1_000_000) ? n : undefined;
}

/** The prices that differ from the base, of what was typed (invalid entries are left out and counted). */
export function changesOf(rows: PriceRow[], draft: Record<string, string>): { changes: Prices; invalid: string[] } {
  const changes: Prices = {};
  const invalid: string[] = [];
  for (const r of rows) {
    if (!(r.path in draft) || r.base === undefined) continue;
    const v = parsePrice(r.kind, draft[r.path]);
    if (v === undefined) invalid.push(r.path);
    else if (v !== r.base) changes[r.path] = v;
  }
  return { changes, invalid };
}

export const SIZES = { small: { cpu: 1, ram: 2, disk: 10 }, medium: { cpu: 2, ram: 4, disk: 20 }, large: { cpu: 8, ram: 16, disk: 100 } } as const;
export type Size = keyof typeof SIZES;
const HOURS = 730;

/**
 * What a month of one application costs with these prices: its resources, two deployments, one P3 incident and what
 * the assistant consumed (2 M tokens in, 0.2 M out, at the first model priced by tokens).
 */
export function monthlyExample(prices: Prices, size: Size): { parts: Array<{ id: string; amount: number }>; total: number; model?: string } {
  const n = (path: string) => (typeof prices[path] === 'number' ? (prices[path] as number) : 0);
  const s = SIZES[size];
  const discount = (1 - n('discount.sustainedUse') / 100) * (1 - n('discount.negotiated') / 100);
  const input = Object.keys(prices).find(p => p.startsWith('assistants.') && p.endsWith('.inputPerMillion') && p.includes('sonnet')) ?? Object.keys(prices).find(p => p.startsWith('assistants.') && p.endsWith('.inputPerMillion'));
  const model = input?.slice('assistants.'.length, input.lastIndexOf('.'));
  const parts = [
    { id: 'cpu', amount: s.cpu * HOURS * n('cpuPerCoreHour') * discount },
    { id: 'ram', amount: s.ram * HOURS * n('ramPerGiBHour') * discount },
    { id: 'disk', amount: s.disk * HOURS * n('storagePerGiBHour') },
    { id: 'deployments', amount: 2 * n('perDeployment') },
    { id: 'incidents', amount: n('perIncident.P3') },
    { id: 'assistant', amount: model ? 2 * n(`assistants.${model}.inputPerMillion`) + 0.2 * n(`assistants.${model}.outputPerMillion`) : 0 },
  ];
  return { parts, total: parts.reduce((a, p) => a + p.amount, 0), model };
}

/** The prices deployed (configuration) and the ones of the repository (backend costs); the page works without the second. */
export function usePrices() {
  const config = useApi(configApiRef);
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const deployed = flatPrices(config.getOptional('opencost.pricing'));
  const currency = config.getOptionalString('opencost.currency') ?? 'EUR';
  const description = config.getOptionalString('opencost.pricing.description');
  const [state, setState] = useState<{ loading: boolean; data?: PricesData; error?: string }>({ loading: true });
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`${await discovery.getBaseUrl('costs')}/prices`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
      return body as PricesData;
    })().then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, turn]);
  const post = useCallback(
    async (changes: Prices): Promise<PricesAnswer> => {
      const res = await fetch(`${await discovery.getBaseUrl('costs')}/prices`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
      return body as PricesAnswer;
    },
    [discovery, fetch],
  );
  return { ...state, deployed, currency: state.data?.currency ?? currency, description: description ?? state.data?.description, post, reload: () => setTurn(n => n + 1) };
}
