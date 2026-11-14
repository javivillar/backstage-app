import { kindOf } from './interconnection';
import type { CatalogZone, InfraView, Programme } from './zone';

/**
 * The programme catalogue of the host (programmes.toml) next to what the platform has: for each programme, whether
 * its segregation and its cluster exist, in its own zone or in another one (a mismatch, shown, never corrected).
 * Test programmes (network.toml test = true) are listed too: laboratory segregations outside the catalogue.
 */
export type Placed = { zone: string; name: string; cluster?: string };
export type ProgrammeRow = Programme & {
  /** a laboratory programme of network.toml, not of the catalogue */
  test: boolean;
  /** its segregation in its own zone */
  placed?: Placed;
  /** a segregation with its name in another zone */
  elsewhere?: Placed;
};

const isProgramme = (p: { name: string; kind?: string }) => kindOf(p.name, p.kind) === 'programme';
const placedIn = (z: CatalogZone | undefined, name: string): Placed | undefined => {
  const p = z?.programs.find(x => x.name === name && isProgramme(x));
  return p && z ? { zone: z.name, name: p.name, cluster: p.cluster } : undefined;
};

/** True when the host publishes the catalogue (an older host does not). */
export const hasCatalogue = (view: InfraView) => !!view.programmeCatalogue;

/** The programmes of the catalogue of a zone, in the order of the file. */
export const programmesOf = (view: InfraView, zone: string): Programme[] => (view.programmeCatalogue?.programmes ?? []).filter(p => p.zone === zone);

/** The programme of the catalogue with that zone and name. */
export const programmeOf = (view: InfraView, zone: string, name: string): Programme | undefined => programmesOf(view, zone).find(p => p.name === name);

/** A row for a laboratory programme: it has no customer or industry. */
export const testProgramme = (zone: string, name: string): ProgrammeRow => ({ zone, name, title: name, description: '', industry: '', customer: '', nations: [], spain: false, confidence: 'high', test: true });

/** Every programme of the catalogue with its place on the platform, then the test programmes. */
export function programmeRows(view: InfraView): ProgrammeRow[] {
  const catalog = view.catalog ?? [];
  const zoneOf = (name: string) => catalog.find(z => z.name === name);
  const rows: ProgrammeRow[] = (view.programmeCatalogue?.programmes ?? []).map(p => {
    const placed = placedIn(zoneOf(p.zone), p.name);
    const elsewhere = catalog.filter(z => z.name !== p.zone).map(z => placedIn(z, p.name)).find(Boolean);
    return { ...p, test: false, placed, elsewhere };
  });
  const tests = catalog.flatMap(z => z.programs.filter(p => p.test && isProgramme(p)).map(p => ({ ...testProgramme(z.name, p.name), placed: { zone: z.name, name: p.name, cluster: p.cluster } })));
  return [...rows, ...tests];
}

/** The texts of a row a search looks in: every value of the catalogue, and the label of its zone. */
export function rowTexts(r: ProgrammeRow, zoneLabel?: string): string[] {
  return [r.title, r.name, `${r.zone}/${r.name}`, r.zone, zoneLabel ?? '', r.description, r.industry, r.customer, r.customerDetail ?? '', ...r.nations, r.managingBody ?? '', r.primeContractor ?? ''].filter(Boolean);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a row matches a search. Typed text matches anywhere ("euro" finds Eurofighter); a value clicked in the
 * table matches as a whole word or phrase ("ES" finds the nation ES and "(ES)" in a customer, not "Forces").
 */
export function matches(texts: string[], query: string, whole = false): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = texts.join(' | ').toLowerCase();
  if (!whole) return hay.includes(q);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(q)}($|[^\\p{L}\\p{N}])`, 'u').test(hay);
}

/** The technical name of a programme: what network.toml takes. */
export const PROGRAMME_NAME = /^[a-z0-9][a-z0-9-]{0,30}$/;
