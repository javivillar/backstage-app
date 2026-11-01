import { type Entity, parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import { classify } from './classify';

/**
 * The model of Portal › Dependencies: the layers of the Refresquito reference architecture (business applications on
 * top, the foundations below, what is outside the zone apart) and the dependencies between the elements of the catalog.
 */
export type Layer = 'biz' | 'app' | 'dat' | 'ops' | 'dev' | 'obs' | 'sec' | 'inf' | 'ext';
export const LAYERS: Layer[] = ['biz', 'app', 'dat', 'ops', 'dev', 'obs', 'sec', 'inf', 'ext'];
export const LAYER_INFO: Record<Layer, { label: string; colour: string }> = {
  biz: { label: 'Business applications', colour: '#FF6B5B' },
  app: { label: 'Application services · APP', colour: '#FF8A5C' },
  dat: { label: 'Data & integration · DAT · INT', colour: '#FFA347' },
  ops: { label: 'Platform operations · OPS', colour: '#FFB547' },
  dev: { label: 'Software delivery · DEV', colour: '#FFC247' },
  obs: { label: 'Observability · OBS', colour: '#F4C430' },
  sec: { label: 'Security · SEC', colour: '#E8B92E' },
  inf: { label: 'Infrastructure · INF', colour: '#D9A82A' },
  ext: { label: 'Outside the zone', colour: '#8592A0' },
};

/** the services by their name (Refresquito charts): the foundation each one belongs to */
const BY_NAME: Array<[RegExp, Layer]> = [
  [/superset|activepieces|bpm|operaton|camunda|alfresco|opensearch|search/, 'app'],
  [/gravitee|datahub|seaweed|redis|rabbit|kafka|postgres|minio/, 'dat'],
  [/harbor|registry|sbom|trivy|cosign|buildkit|images/, 'dev'],
  [/prometheus|loki|grafana|observability|monitoring|alloy|tempo/, 'obs'],
  [/iam|keycloak|wazuh|step-ca|cert-manager|secrets|shuffle|iris|soc|vault/, 'sec'],
  [/longhorn|calico|metallb|traefik|oneke|opennebula|storage/, 'inf'],
  [/cnoe|backstage|argo|opencost|crossplane|assistant|support|topology/, 'ops'],
];
const BY_SEGMENT: Record<string, Layer> = {
  'business-support': 'app',
  'data-management': 'dat',
  integration: 'dat',
  iam: 'sec',
  soc: 'sec',
  observability: 'obs',
  platform: 'ops',
};

export function layerOf(e: Entity): Layer {
  if (e.kind === 'Resource') {
    const type = String(e.spec?.type ?? '');
    if (/external|smtp|internet|saas/.test(type) || e.metadata.annotations?.['refresquito.io/external']) return 'ext';
  }
  if (classify(e) === 'business') return 'biz';
  const name = e.metadata.name.toLowerCase();
  for (const [re, layer] of BY_NAME) if (re.test(name)) return layer;
  const seg = e.metadata.labels?.['refresquito.io/segment'];
  if (seg && BY_SEGMENT[seg]) return BY_SEGMENT[seg];
  return e.kind === 'Resource' ? 'inf' : 'ops';
}

export type Health = 'ok' | 'warn' | 'bad' | 'off';
export type DepNodeModel = { id: string; entity: Entity; label: string; product: string; layer: Layer; health: Health; healthLabel: string; deg: number };
export type DepLink = { source: string; target: string; label: string; type: 'dep' | 'api' };

/**
 * The nodes (components and resources) and links: dependsOn, and an API consumed drawn to the component that provides
 * it (labelled with the API). Links to elements not in the catalog are dropped.
 */
export function buildGraph(entities: Entity[], health: (e: Entity) => { tone: Health; label: string }): { nodes: DepNodeModel[]; links: DepLink[] } {
  const items = entities.filter(e => e.kind === 'Component' || e.kind === 'Resource');
  const ids = new Set(items.map(e => stringifyEntityRef(e)));
  // the providers of each API
  const providers = new Map<string, string[]>();
  for (const e of entities)
    for (const r of e.relations ?? [])
      if (r.type === 'providesApi') providers.set(r.targetRef, [...(providers.get(r.targetRef) ?? []), stringifyEntityRef(e)]);
  const links: DepLink[] = [];
  const seen = new Set<string>();
  const add = (source: string, target: string, label: string, type: DepLink['type']) => {
    const k = `${source}>${target}`;
    if (source === target || seen.has(k) || !ids.has(source) || !ids.has(target)) return;
    seen.add(k);
    links.push({ source, target, label, type });
  };
  for (const e of items) {
    const me = stringifyEntityRef(e);
    for (const r of e.relations ?? []) {
      if (r.type === 'dependsOn') add(me, r.targetRef, 'depends on', 'dep');
      if (r.type === 'dependencyOf') add(r.targetRef, me, 'depends on', 'dep');
      if (r.type === 'consumesApi') for (const p of providers.get(r.targetRef) ?? []) add(me, p, `${parseEntityRef(r.targetRef).name} API`, 'api');
    }
  }
  const deg = new Map<string, number>();
  links.forEach(l => deg.set(l.target, (deg.get(l.target) ?? 0) + 1));
  const nodes = items.map(e => {
    const id = stringifyEntityRef(e);
    const h = health(e);
    const product = String(e.metadata.annotations?.['refresquito.io/product'] ?? e.spec?.type ?? e.kind.toLowerCase());
    return { id, entity: e, label: e.metadata.title ?? e.metadata.name, product, layer: layerOf(e), health: h.tone, healthLabel: h.label, deg: deg.get(id) ?? 0 };
  });
  return { nodes, links };
}

/** the nodes reachable from start in at most max hops: downstream only (what it uses) or both ways */
export function reach(start: string, links: DepLink[], max: number, down: boolean): Map<string, number> {
  const dist = new Map([[start, 0]]);
  const q = [start];
  while (q.length) {
    const c = q.shift()!;
    if (dist.get(c)! >= max) continue;
    for (const l of links) {
      let nx: string | undefined;
      if (l.source === c) nx = l.target;
      else if (!down && l.target === c) nx = l.source;
      if (nx && !dist.has(nx)) {
        dist.set(nx, dist.get(c)! + 1);
        q.push(nx);
      }
    }
  }
  return dist;
}

export const BAND_H = 165;
const MID = 4;
export const layerY = (k: Layer) => (k === 'ext' ? (LAYERS.indexOf('inf') - MID) * BAND_H + BAND_H * 1.6 : (LAYERS.indexOf(k) - MID) * BAND_H);
export const nodeY = (k: Layer) => layerY(k) - 28;
const INNER = LAYERS.filter(k => k !== 'ext');
export const GLASS = {
  top: layerY(INNER[0]) - BAND_H / 2,
  bottom: layerY(INNER[INNER.length - 1]) + BAND_H / 2,
  halfTop: 1080,
  halfBottom: 900,
};
/** the half width of the glass at a height */
export const wAt = (y: number) => GLASS.halfTop - (GLASS.halfTop - GLASS.halfBottom) * ((y - GLASS.top) / (GLASS.bottom - GLASS.top));

/** Stack: every layer spread across the glass, each node near its neighbours of the other layers (barycentres). */
export function stackLayout(nodes: DepNodeModel[], links: DepLink[]): Map<string, { x: number; y: number }> {
  const by = new Map<Layer, DepNodeModel[]>();
  nodes.forEach(n => by.set(n.layer, [...(by.get(n.layer) ?? []), n]));
  const pos = new Map<string, { x: number; y: number }>();
  const place = (k: Layer) => {
    const arr = by.get(k) ?? [];
    const y = nodeY(k);
    const half = (k === 'ext' ? GLASS.halfBottom : wAt(y)) - 110;
    arr.forEach((n, i) => pos.set(n.id, { x: arr.length === 1 ? 0 : -half + (2 * half * i) / (arr.length - 1), y }));
  };
  LAYERS.forEach(place);
  const layerOfId = new Map(nodes.map(n => [n.id, n.layer]));
  for (let pass = 0; pass < 4; pass++)
    for (const k of LAYERS) {
      const arr = by.get(k) ?? [];
      const order = new Map<string, number>();
      for (const n of arr) {
        const nb = links
          .filter(l => l.source === n.id || l.target === n.id)
          .map(l => (l.source === n.id ? l.target : l.source))
          .filter(m => layerOfId.get(m) !== k && pos.has(m));
        order.set(n.id, nb.length ? nb.reduce((t, m) => t + pos.get(m)!.x, 0) / nb.length : pos.get(n.id)!.x);
      }
      arr.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      place(k);
    }
  return pos;
}

/** Graph: a few hundred steps of a small force layout (repulsion, springs on the links, a pull to the centre). */
export function forceLayout(nodes: DepNodeModel[], links: DepLink[], start: Map<string, { x: number; y: number }>, steps = 300): Map<string, { x: number; y: number }> {
  const p = nodes.map(n => ({ id: n.id, ...(start.get(n.id) ?? { x: Math.random() * 400 - 200, y: Math.random() * 400 - 200 }), vx: 0, vy: 0 }));
  const idx = new Map(p.map((n, i) => [n.id, i]));
  const ls = links.map(l => [idx.get(l.source), idx.get(l.target)]).filter((x): x is [number, number] => x[0] !== undefined && x[1] !== undefined);
  for (let s = 0; s < steps; s++) {
    const alpha = 1 - s / steps;
    for (let i = 0; i < p.length; i++)
      for (let j = i + 1; j < p.length; j++) {
        const dx = p[j].x - p[i].x || 0.01;
        const dy = p[j].y - p[i].y || 0.01;
        const d2 = Math.max(dx * dx + dy * dy, 400);
        const f = (60000 / d2) * alpha;
        const d = Math.sqrt(d2);
        p[i].vx -= (dx / d) * f;
        p[i].vy -= (dy / d) * f;
        p[j].vx += (dx / d) * f;
        p[j].vy += (dy / d) * f;
      }
    for (const [a, b] of ls) {
      const dx = p[b].x - p[a].x;
      const dy = p[b].y - p[a].y;
      const d = Math.max(Math.hypot(dx, dy), 1);
      const f = (d - 220) * 0.04 * alpha;
      p[a].vx += (dx / d) * f;
      p[a].vy += (dy / d) * f;
      p[b].vx -= (dx / d) * f;
      p[b].vy -= (dy / d) * f;
    }
    for (const n of p) {
      n.vx -= n.x * 0.01 * alpha;
      n.vy -= n.y * 0.01 * alpha;
      n.x += Math.max(-40, Math.min(40, n.vx));
      n.y += Math.max(-40, Math.min(40, n.vy));
      n.vx *= 0.6;
      n.vy *= 0.6;
    }
  }
  return new Map(p.map(n => [n.id, { x: n.x, y: n.y }]));
}
