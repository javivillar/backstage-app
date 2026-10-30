import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { useEffect, useState } from 'react';
import { NAMESPACE_ANNOTATION } from '../catalog/usePrometheus';

/**
 * What the assistants of Backstage consumed this month (plugins/ops-assistant-backend/src/usage.ts, GET
 * /api/ops-assistant/usage), charged to the system each question was about: the one chosen in the page, else the
 * systems the tools were asked about (directly, or through a namespace or a project of the catalog), else the platform.
 * A question about several systems is split between them in equal parts.
 *
 * The price is ours (opencost.pricing.assistants), by model or runner: per million tokens (a model billed by use), or
 * per hour of answering (a local model: what costs is the server busy). Not a bill.
 */
export type UsageGroup = {
  assistant: string;
  /** undefined: someone else's question, and the viewer may not see who */
  user?: string;
  runner: string;
  model: string;
  system?: string;
  systems: string[];
  namespaces: string[];
  components: string[];
  questions: number;
  unreported: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  ms: number;
};
export type MonthUsage = { month: string; all: boolean; groups: UsageGroup[] };

/** a price of opencost.pricing.assistants: the first whose model (part of the name) and runner match */
export type AssistantPrice = {
  model?: string;
  runner?: string;
  inputPerMillion?: number;
  outputPerMillion?: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
  /** per hour of answering: a local model, where the tokens cost nothing and the server does */
  perHour?: number;
};

/** what is not about any system of the catalog */
export const PLATFORM = '(platform)';

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const names = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function parseUsage(body: any): MonthUsage {
  const groups: UsageGroup[] = (Array.isArray(body?.groups) ? body.groups : [])
    .filter((g: any) => typeof g?.assistant === 'string')
    .map((g: any) => ({
      assistant: g.assistant,
      user: typeof g.user === 'string' ? g.user : undefined,
      runner: typeof g.runner === 'string' ? g.runner : '',
      model: typeof g.model === 'string' ? g.model : '',
      system: typeof g.system === 'string' && g.system ? g.system : undefined,
      systems: names(g.systems),
      namespaces: names(g.namespaces),
      components: names(g.components),
      questions: num(g.questions),
      unreported: num(g.unreported),
      input: num(g.input),
      output: num(g.output),
      cacheRead: num(g.cacheRead),
      cacheWrite: num(g.cacheWrite),
      ms: num(g.ms),
    }));
  return { month: typeof body?.month === 'string' ? body.month : '', all: body?.all === true, groups };
}

/** the price of a group; undefined when none matches */
export function priceOf(g: Pick<UsageGroup, 'model' | 'runner'>, prices: AssistantPrice[] | undefined) {
  const model = g.model.toLocaleLowerCase('en-US');
  return prices?.find(
    p =>
      (!p.model || p.model === '*' || model.includes(p.model.toLocaleLowerCase('en-US'))) &&
      (!p.runner || p.runner === g.runner),
  );
}

/** what a group cost at its price; undefined without one */
export function usageCost(g: UsageGroup, prices: AssistantPrice[] | undefined): number | undefined {
  const p = priceOf(g, prices);
  if (!p) return undefined;
  const perM = (count: number, price?: number) => (count * (price ?? 0)) / 1e6;
  return (
    perM(g.input, p.inputPerMillion) +
    perM(g.output, p.outputPerMillion) +
    perM(g.cacheRead, p.cacheReadPerMillion) +
    perM(g.cacheWrite, p.cacheWritePerMillion) +
    (g.ms / 3600000) * (p.perHour ?? 0)
  );
}

export const tokensOf = (g: Pick<UsageGroup, 'input' | 'output' | 'cacheRead' | 'cacheWrite'>) => g.input + g.output + g.cacheRead + g.cacheWrite;

/** the catalog, to know the system of a namespace or of a project */
export type SystemsIndex = { ofNamespace: Map<string, string>; ofComponent: Map<string, string> };

/** the systems a group is charged to: the chosen one, else what its tools looked at, else the platform */
export function systemsOf(g: UsageGroup, index: SystemsIndex): string[] {
  if (g.system) return [g.system];
  const out = new Set(g.systems);
  for (const ns of g.namespaces) {
    const s = index.ofNamespace.get(ns);
    if (s) out.add(s);
  }
  for (const c of g.components) {
    const s = index.ofComponent.get(c);
    if (s) out.add(s);
  }
  return out.size ? [...out].sort() : [PLATFORM];
}

export type Charge = { questions: number; tokens: number; cost?: number; unreported: number };
const zero = (): Charge => ({ questions: 0, tokens: 0, cost: undefined, unreported: 0 });
const add = (c: Charge, share: number, g: UsageGroup, cost: number | undefined): Charge => ({
  questions: c.questions + g.questions * share,
  tokens: c.tokens + tokensOf(g) * share,
  cost: cost === undefined ? c.cost : (c.cost ?? 0) + cost * share,
  unreported: c.unreported + g.unreported * share,
});

/** the month charged to each system (split in equal parts when a question is about several), and in total */
export function chargeBySystem(usage: MonthUsage, index: SystemsIndex, prices: AssistantPrice[] | undefined) {
  const bySystem = new Map<string, Charge>();
  let total = zero();
  for (const g of usage.groups) {
    const cost = usageCost(g, prices);
    const systems = systemsOf(g, index);
    for (const s of systems) bySystem.set(s, add(bySystem.get(s) ?? zero(), 1 / systems.length, g, cost));
    total = add(total, 1, g, cost);
  }
  return { bySystem, total };
}

/** the month by assistant and user (who: only the viewer's own, unless the viewer may see everyone's) */
export function chargeByAssistant(usage: MonthUsage, prices: AssistantPrice[] | undefined) {
  const m = new Map<string, Charge & { assistant: string; user?: string; models: Set<string> }>();
  for (const g of usage.groups) {
    const key = `${g.assistant}\u0000${g.user ?? ''}`;
    const prev = m.get(key) ?? { ...zero(), assistant: g.assistant, user: g.user, models: new Set<string>() };
    prev.models.add(g.model);
    m.set(key, { ...add(prev, 1, g, usageCost(g, prices)), assistant: g.assistant, user: g.user, models: prev.models });
  }
  return [...m.values()].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || b.tokens - a.tokens);
}

/** "1.2 M", "35 k", "900" */
export function tokens(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(Math.round(n));
}

/** "user:default/ana" -> "ana" */
export const userName = (ref?: string) => (ref ? ref.split('/').pop()! : 'others');

/** what the assistants consumed this month; error when it is not recorded (the page then shows the rest) */
export function useAssistantUsage() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; value?: MonthUsage; error?: Error }>({ loading: true });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`${await discovery.getBaseUrl('ops-assistant')}/usage`);
      if (!res.ok) throw new Error(`the assistants answered ${res.status} ${res.statusText}`);
      return parseUsage(await res.json());
    })().then(
      value => !cancelled && setState({ loading: false, value }),
      error => !cancelled && setState({ loading: false, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [discovery, fetch]);
  return state;
}

/** the system of each namespace and of each component of the catalog */
export function useSystemsIndex(): SystemsIndex {
  const catalog = useApi(catalogApiRef);
  const [index, setIndex] = useState<SystemsIndex>({ ofNamespace: new Map(), ofComponent: new Map() });
  useEffect(() => {
    catalog
      .getEntities({
        filter: { kind: ['component', 'resource', 'api'] },
        fields: ['kind', 'metadata.name', 'metadata.annotations', 'spec.system'],
      })
      .then(({ items }) => {
        const ofNamespace = new Map<string, string>();
        const ofComponent = new Map<string, string>();
        for (const e of items) {
          const system = typeof e.spec?.system === 'string' ? e.spec.system.split('/').pop()! : '';
          if (!system) continue;
          const ns = e.metadata.annotations?.[NAMESPACE_ANNOTATION];
          if (ns && !ofNamespace.has(ns)) ofNamespace.set(ns, system);
          if (e.kind === 'Component') ofComponent.set(e.metadata.name.toLocaleLowerCase('en-US'), system);
        }
        setIndex({ ofNamespace, ofComponent });
      })
      .catch(() => undefined);
  }, [catalog]);
  return index;
}
