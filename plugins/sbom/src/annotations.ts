import { Entity } from '@backstage/catalog-model';

/**
 * The images a component runs, comma separated (ghcr.io/owner/app-api:<tag>,ghcr.io/owner/app-web:<tag>): the
 * catalog of refresquito-services writes it with the tag deployed in its stage. Their SBOMs are what the tab shows.
 */
export const ANNOTATION_SBOM_IMAGES = 'refresquito.io/sbom-images';
/**
 * The releases of GitHub whose SBOM file describes a library, comma separated (owner/repo@tag): a line of the
 * Python Framework says the releases of its two parts.
 */
export const ANNOTATION_SBOM_RELEASES = 'refresquito.io/sbom-releases';

export type SbomSource = { kind: 'image' | 'release'; ref: string };

const list = (entity: Entity, key: string) =>
  (entity.metadata.annotations?.[key] ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

export const sbomImages = (entity: Entity): string[] => list(entity, ANNOTATION_SBOM_IMAGES);

export function sbomSources(entity: Entity): SbomSource[] {
  return [
    ...sbomImages(entity).map(ref => ({ kind: 'image' as const, ref })),
    ...list(entity, ANNOTATION_SBOM_RELEASES).map(ref => ({ kind: 'release' as const, ref })),
  ];
}

export const isSbomAvailable = (entity: Entity): boolean => sbomSources(entity).length > 0;
