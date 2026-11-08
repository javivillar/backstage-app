import { type Entity, parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import { classify, segmentOf } from './classify';

/**
 * The model of Portal › Dependencies: the layers of the Refresquito reference architecture (business applications on
 * top, the foundations below, what is outside the zone apart) and the dependencies between the elements of the catalog.
 */
export type Layer = 'dom' | 'proc' | 'biz' | 'fwk' | 'app' | 'dat' | 'ops' | 'dev' | 'obs' | 'sec' | 'inf' | 'ext';
export const LAYERS: Layer[] = ['biz', 'fwk', 'app', 'dat', 'ops', 'dev', 'obs', 'sec', 'inf', 'ext'];
/** the business glass (Business map › Glass): the business domains and processes on top of the same layers */
export const BUSINESS_LAYERS: Layer[] = ['dom', 'proc', ...LAYERS];
export const LAYER_INFO: Record<Layer, { label: string; colour: string }> = {
  dom: { label: 'Business domains', colour: '#E2553F' },
  proc: { label: 'Business processes', colour: '#F0604D' },
  biz: { label: 'Business services · applications', colour: '#FF6B5B' },
  fwk: { label: 'Development services · frameworks', colour: '#FF7D5C' },
  app: { label: 'Application services · APP', colour: '#FF8A5C' },
  dat: { label: 'Data & integration · DAT · INT', colour: '#FFA347' },
  ops: { label: 'Platform operations · OPS', colour: '#FFB547' },
  dev: { label: 'Software delivery · DEV', colour: '#FFC247' },
  obs: { label: 'Observability · OBS', colour: '#F4C430' },
  sec: { label: 'Security · SEC', colour: '#E8B92E' },
  inf: { label: 'Infrastructure · INF', colour: '#D9A82A' },
  ext: { label: 'Outside the zone', colour: '#8592A0' },
};

/** the bands a Refresquito service can declare (refresquito.io/layer), fwk being the development services */
export const SERVICE_LAYERS: Layer[] = ['app', 'dat', 'ops', 'dev', 'obs', 'sec', 'inf', 'fwk'];
const DECLARABLE = new Set<string>(SERVICE_LAYERS);

/**
 * When a service does not declare its layer: by its name (Refresquito charts), in this order — the specific ones
 * first, infrastructure last (its names are generic: nodes, storage).
 */
const BY_NAME: Array<[RegExp, Layer]> = [
  [/superset|bpm|operaton|camunda|alfresco|opensearch/, 'app'],
  [/gravitee|datahub|seaweed|redis|rabbit|events|kafka|postgres|database|minio|activepieces/, 'dat'],
  [/harbor|registry|sbom|trivy|cosign|buildkit|images|functionalassistant|architectassistant|developerassistant/, 'dev'],
  [/prometheus|loki|grafana|observability|monitoring|alloy|tempo|whisker/, 'obs'],
  [/iam|keycloak|wazuh|step-ca|stepca|pki|cert-manager|secrets|shuffle|iris|misp|intelmq|secassistant|soc|vault/, 'sec'],
  [/cnoe|backstage|argo|opencost|crossplane|headlamp|console-vms|continuity|opsassistant|assistant|support|topology/, 'ops'],
  [/longhorn|calico|segments|metallb|traefik|opennebula|nodes|storage/, 'inf'],
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
  if (e.kind === 'Domain') return 'dom';
  if (e.kind === 'BusinessProcess') return 'proc';
  // what the service says (catalog.services.<name>.layer of refresquito-services) wins over any guess
  const declared = e.metadata.annotations?.['refresquito.io/layer'];
  if (declared && DECLARABLE.has(declared)) return declared as Layer;
  // a database is data, whatever application it is of
  if (e.kind === 'Resource' && String(e.spec?.type ?? '') === 'database') return 'dat';
  const kind = classify(e);
  if (kind === 'business') return 'biz';
  if (kind === 'development') return 'fwk';
  const name = e.metadata.name.toLowerCase();
  for (const [re, layer] of BY_NAME) if (re.test(name)) return layer;
  const seg = segmentOf(e);
  if (seg && BY_SEGMENT[seg]) return BY_SEGMENT[seg];
  return e.kind === 'Resource' ? 'inf' : 'ops';
}

/**
 * The category of an entity in the catalogue of the console: a business application, or the band of a Refresquito
 * service (a development service is fwk); undefined for the rest (APIs, systems, what nothing classifies).
 */
export function catalogueCategory(e: Entity): 'business' | Layer | undefined {
  const kind = classify(e);
  if (kind === 'business') return 'business';
  if (kind === 'development') return 'fwk';
  if (kind !== 'service') return undefined;
  const layer = layerOf(e);
  return DECLARABLE.has(layer) ? layer : 'ops';
}

/**
 * The layer of an entity knowing the others: a Resource that does not declare its layer (an application's block: its
 * bucket, its SSO client) takes the layer of the service that provides it (refresquito.io/provided-by, else the
 * Component it depends on); a database stays data; else layerOf.
 */
export function layerAmong(e: Entity, byRef: Map<string, Entity>): Layer {
  const own = layerOf(e);
  const declared = e.metadata.annotations?.['refresquito.io/layer'];
  if (e.kind !== 'Resource' || declared || own === 'ext' || String(e.spec?.type ?? '') === 'database') return own;
  const providedBy = e.metadata.annotations?.['refresquito.io/provided-by'];
  const candidates = [
    ...(providedBy ? [`component:default/${providedBy}`] : []),
    ...(e.relations ?? []).filter(r => r.type === 'dependsOn' && r.targetRef.startsWith('component:')).map(r => r.targetRef),
  ];
  for (const ref of candidates) {
    const provider = byRef.get(ref);
    if (provider && provider.kind === 'Component') return layerOf(provider);
  }
  return own;
}

export type Health = 'ok' | 'warn' | 'bad' | 'off';
export type DepNodeModel = { id: string; entity: Entity; label: string; product: string; layer: Layer; health: Health; healthLabel: string; deg: number };
export type DepLink = { source: string; target: string; label: string; type: 'dep' | 'api' };

/**
 * a node of the glass: components, resources and the business services (Systems of type business-service); and for the
 * business glass the business domains (Domains of type business-area) and the business processes
 */
const isNode = (e: Entity) =>
  e.kind === 'Component' ||
  e.kind === 'Resource' ||
  e.kind === 'BusinessProcess' ||
  (e.kind === 'Domain' && e.spec?.type === 'business-area') ||
  (e.kind === 'System' && classify(e) === 'business');

/**
 * The nodes and links: dependsOn, an API consumed drawn to the component that provides it (labelled with the API), a
 * business service to its business application (hasPart) and an application to its instances (hasSubcomponent).
 * Links to elements not in the catalog are dropped.
 */
export function buildGraph(entities: Entity[], health: (e: Entity) => { tone: Health; label: string }): { nodes: DepNodeModel[]; links: DepLink[] } {
  const items = entities.filter(isNode);
  const byRef = new Map(items.map(e => [stringifyEntityRef(e), e]));
  const all = new Map(entities.map(e => [stringifyEntityRef(e), e]));
  // the providers of each API
  const providers = new Map<string, string[]>();
  for (const e of entities)
    for (const r of e.relations ?? [])
      if (r.type === 'providesApi') providers.set(r.targetRef, [...(providers.get(r.targetRef) ?? []), stringifyEntityRef(e)]);
  const links: DepLink[] = [];
  const seen = new Set<string>();
  const add = (source: string, target: string, label: string, type: DepLink['type']) => {
    const k = `${source}>${target}`;
    if (source === target || seen.has(k) || !byRef.has(source) || !byRef.has(target)) return;
    seen.add(k);
    links.push({ source, target, label, type });
  };
  for (const e of items) {
    const me = stringifyEntityRef(e);
    for (const r of e.relations ?? []) {
      if (r.type === 'dependsOn') add(me, r.targetRef, 'depends on', 'dep');
      if (r.type === 'dependencyOf') add(r.targetRef, me, 'depends on', 'dep');
      if (r.type === 'consumesApi') for (const p of providers.get(r.targetRef) ?? []) add(me, p, `${parseEntityRef(r.targetRef).name} API`, 'api');
      if (e.kind === 'System' && r.type === 'hasPart' && byRef.get(r.targetRef)?.spec?.type === 'business-application') add(me, r.targetRef, 'application', 'dep');
      if (e.spec?.type === 'business-application' && r.type === 'hasSubcomponent') add(me, r.targetRef, 'instance', 'dep');
      if (e.kind === 'Domain' && r.type === 'hasPart') add(me, r.targetRef, byRef.get(r.targetRef)?.kind === 'Domain' ? 'subdomain' : 'process', 'dep');
    }
  }
  const deg = new Map<string, number>();
  links.forEach(l => deg.set(l.target, (deg.get(l.target) ?? 0) + 1));
  const nodes = items.map(e => {
    const id = stringifyEntityRef(e);
    const h = health(e);
    const product = String(e.metadata.annotations?.['refresquito.io/product'] ?? e.spec?.type ?? e.kind.toLowerCase());
    return { id, entity: e, label: e.metadata.title ?? e.metadata.name, product, layer: layerAmong(e, all), health: h.tone, healthLabel: h.label, deg: deg.get(id) ?? 0 };
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

/**
 * The nodes in the chain of an element: what it uses, all the way down, and who uses it, all the way up (not the
 * siblings: walking down from a service does not come back up through another application).
 */
export function chainOf(start: string, links: DepLink[]): Set<string> {
  const walk = (down: boolean) => {
    const seen = new Set([start]);
    const q = [start];
    while (q.length) {
      const c = q.shift()!;
      for (const l of links) {
        const from = down ? l.source : l.target;
        const to = down ? l.target : l.source;
        if (from === c && !seen.has(to)) {
          seen.add(to);
          q.push(to);
        }
      }
    }
    return seen;
  };
  return new Set([...walk(true), ...walk(false)]);
}

export const BAND_H = 165;
const MID = 4;
/** the height of a layer; the business glass (BUSINESS_LAYERS) has two more bands on top */
export const layerY = (k: Layer, layers: Layer[] = LAYERS) =>
  k === 'ext' ? (layers.indexOf('inf') - MID) * BAND_H + BAND_H * 1.6 : (layers.indexOf(k) - MID) * BAND_H;
export const nodeY = (k: Layer, layers: Layer[] = LAYERS) => layerY(k, layers) - 28;
export type GlassShape = { top: number; bottom: number; halfTop: number; halfBottom: number };
/** the outline of the glass for some layers */
export function glassFor(layers: Layer[]): GlassShape {
  const inner = layers.filter(k => k !== 'ext');
  return { top: layerY(inner[0], layers) - BAND_H / 2, bottom: layerY(inner[inner.length - 1], layers) + BAND_H / 2, halfTop: 1080, halfBottom: 900 };
}
export const GLASS = glassFor(LAYERS);
/** the half width of the glass at a height */
export const wAt = (y: number, g: GlassShape = GLASS) => g.halfTop - (g.halfTop - g.halfBottom) * ((y - g.top) / (g.bottom - g.top));
/** the SVG path of the glass itself (its sides and its round bottom) */
export function glassPath(g: GlassShape = GLASS): string {
  const { top, bottom, halfTop, halfBottom } = g;
  return `M${-halfTop - 40},${top - 30} L${-halfBottom - 30},${bottom + 26} Q${-halfBottom - 30},${bottom + 70} ${-halfBottom + 30},${bottom + 70} L${halfBottom - 30},${bottom + 70} Q${halfBottom + 30},${bottom + 70} ${halfBottom + 30},${bottom + 26} L${halfTop + 40},${top - 30}`;
}

/** Stack: every layer spread across the glass, each node near its neighbours of the other layers (barycentres). */
export function stackLayout(nodes: DepNodeModel[], links: DepLink[], layers: Layer[] = LAYERS): Map<string, { x: number; y: number }> {
  const g = glassFor(layers);
  const by = new Map<Layer, DepNodeModel[]>();
  nodes.forEach(n => by.set(n.layer, [...(by.get(n.layer) ?? []), n]));
  const pos = new Map<string, { x: number; y: number }>();
  const place = (k: Layer) => {
    const arr = by.get(k) ?? [];
    const y = nodeY(k, layers);
    const half = (k === 'ext' ? g.halfBottom : wAt(y, g)) - 110;
    arr.forEach((n, i) => pos.set(n.id, { x: arr.length === 1 ? 0 : -half + (2 * half * i) / (arr.length - 1), y }));
  };
  layers.forEach(place);
  const layerOfId = new Map(nodes.map(n => [n.id, n.layer]));
  for (let pass = 0; pass < 4; pass++)
    for (const k of layers) {
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
