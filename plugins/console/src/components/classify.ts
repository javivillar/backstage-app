import type { Entity } from '@backstage/catalog-model';

export type Kind = 'business' | 'service' | 'development' | 'other';

/** the types of the business map in the catalog: what each one is in the console */
const BY_TYPE: Record<string, Kind> = {
  'business-service': 'business',
  'business-application': 'business',
  'application-instance': 'business',
  'platform-service': 'service',
  'development-service': 'development',
  'framework-line': 'development',
};

/** The kind of a spec.type of the business map, or undefined for any other type (service, library, a block…). */
export const kindOfType = (type: unknown): Kind | undefined => (typeof type === 'string' ? BY_TYPE[type] : undefined);

/** the name of the System of an entity (spec.system as a name or a ref) */
export const systemName = (e: Entity): string | undefined => {
  const s = e.spec?.system;
  return typeof s === 'string' && s ? s.split('/').pop()!.replace(/^system:/, '') : undefined;
};

/**
 * Business, Refresquito (platform) or development service. The spec.type of the business map says it; a catalog
 * without those types (before piece 0) falls back to the annotations of the app-of-apps: refresquito.io/application →
 * business, label refresquito.io/segment → service; and to the old Systems business-systems and framework-development.
 */
export function classify(e: Entity): Kind {
  const byType = kindOfType(e.spec?.type);
  if (byType) return byType;
  if (e.metadata.annotations?.['refresquito.io/application']) return 'business';
  if (e.metadata.labels?.['refresquito.io/segment']) return 'service';
  const system = systemName(e);
  if (system === 'business-systems') return 'business';
  if (system === 'framework-development') return 'development';
  return 'other';
}

/** The network segment of an entity: its label (the System was the segment before piece 0, now the business service). */
export const segmentOf = (e: Entity): string | undefined =>
  e.metadata.labels?.['refresquito.io/segment'] ?? e.metadata.annotations?.['refresquito.io/segment'];

export const entityPath = (e: Entity) =>
  `/catalog/${e.metadata.namespace ?? 'default'}/${e.kind.toLowerCase()}/${e.metadata.name}`;

/** The page of an entity inside the console (same tabs and cards as the classic page). */
export const consoleEntityPath = (e: Entity) =>
  `/console/entity/${e.metadata.namespace ?? 'default'}/${e.kind.toLowerCase()}/${e.metadata.name}`;
