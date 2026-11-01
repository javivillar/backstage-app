import type { Entity } from '@backstage/catalog-model';

export type Kind = 'business' | 'service' | 'other';

/**
 * Business applications come from the files apps/*.yaml of the app-of-apps (annotation refresquito.io/application);
 * the other components the app-of-apps deploys (label refresquito.io/segment) are Refresquito services.
 */
export function classify(e: Entity): Kind {
  if (e.metadata.annotations?.['refresquito.io/application']) return 'business';
  if (e.metadata.labels?.['refresquito.io/segment']) return 'service';
  return 'other';
}

export const entityPath = (e: Entity) =>
  `/catalog/${e.metadata.namespace ?? 'default'}/${e.kind.toLowerCase()}/${e.metadata.name}`;

/** The page of an entity inside the console (same tabs and cards as the classic page). */
export const consoleEntityPath = (e: Entity) =>
  `/console/entity/${e.metadata.namespace ?? 'default'}/${e.kind.toLowerCase()}/${e.metadata.name}`;
