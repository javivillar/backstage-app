import { type Entity, stringifyEntityRef } from '@backstage/catalog-model';
import type { AppOverview } from '../overview';
import { consoleEntityPath } from './classify';
import { catalogueCategory, type Health, type Layer } from './depsModel';

/**
 * The model of Cluster › Overview › Architecture: what the catalogue of the console lists (its Components), grouped by
 * the bands of the catalogue, each piece with its namespace and the state of its Argo CD application.
 */

/** The bands, top to bottom: the business first, the foundations below, what only exists at build time last. */
export const ARCH_BANDS: Layer[] = ['biz', 'app', 'dat', 'ops', 'dev', 'obs', 'sec', 'inf', 'fwk'];
export const BAND_CODE: Partial<Record<Layer, string>> = { biz: 'BIZ', app: 'APP', dat: 'DAT · INT', ops: 'OPS', dev: 'DEV', obs: 'OBS', sec: 'SEC', inf: 'INF', fwk: 'FWK' };

export type ArchTile = {
  id: string;
  name: string;
  /** undefined: nothing says where it runs (a framework, a library, a piece that lives inside another) */
  namespace?: string;
  health: Health;
  healthLabel: string;
  /** the product behind it, or what it is */
  sub: string;
  to: string;
  suspended: boolean;
};
export type ArchBand = { layer: Layer; tiles: ArchTile[]; namespaces: number; without: number };

/** The Argo CD application of an entity: the same name, with or without the -oneke of the Refresquito charts. */
export function appOf(name: string, apps: AppOverview[]): AppOverview | undefined {
  const bare = name.replace(/-oneke$/, '');
  return apps.find(a => a.name === name || a.name === bare || a.name === `${bare}-oneke`);
}

function health(a: AppOverview | undefined, suspended: boolean): { tone: Health; label: string } {
  if (suspended) return { tone: 'warn', label: 'suspended' };
  if (!a) return { tone: 'off', label: 'no Argo CD application' };
  if (a.health === 'Healthy' && a.sync === 'Synced') return { tone: 'ok', label: 'Healthy · Synced' };
  if (a.health === 'Degraded' || a.health === 'Missing') return { tone: 'bad', label: `${a.health} · ${a.sync}` };
  return { tone: 'warn', label: `${a.health} · ${a.sync}` };
}

const RANK: Record<Health, number> = { bad: 0, warn: 1, ok: 2, off: 3 };

/** The bands with their pieces: what runs first (problems first among them), what has no namespace last. */
export function clusterBands(entities: Entity[], apps: AppOverview[]): ArchBand[] {
  const components = entities.filter(e => e.kind === 'Component');
  const byRef = new Map(entities.map(e => [stringifyEntityRef(e), e] as const));
  const bands = new Map<Layer, ArchTile[]>(ARCH_BANDS.map(l => [l, []]));
  for (const e of components) {
    const category = catalogueCategory(e, byRef);
    if (!category) continue;
    const layer: Layer = category === 'business' ? 'biz' : category;
    const ann = e.metadata.annotations ?? {};
    const app = appOf(e.metadata.name, apps);
    const suspended = ann['refresquito.io/suspended'] === 'true';
    const h = health(app, suspended);
    const product = ann['refresquito.io/product'];
    const stage = ann['refresquito.io/stage'];
    const type = String(e.spec?.type ?? '');
    bands.get(layer)?.push({
      id: stringifyEntityRef(e),
      name: e.metadata.title ?? e.metadata.name.replace(/-oneke$/, ''),
      namespace: ann['refresquito.io/namespace'] || app?.namespace || undefined,
      health: h.tone,
      healthLabel: h.label,
      sub: [product ?? type, stage].filter(Boolean).join(' · '),
      to: consoleEntityPath(e),
      suspended,
    });
  }
  return ARCH_BANDS.map(layer => {
    const tiles = (bands.get(layer) ?? []).sort((a, b) => Number(!a.namespace) - Number(!b.namespace) || RANK[a.health] - RANK[b.health] || a.name.localeCompare(b.name));
    return { layer, tiles, namespaces: new Set(tiles.map(x => x.namespace).filter(Boolean)).size, without: tiles.filter(x => !x.namespace).length };
  });
}

/** Two letters for the square of a tile: the initials of its words, else its first two letters. */
export function monogram(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const two = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? name).slice(0, 2);
  return two.toUpperCase();
}
