import { Entity } from '@backstage/catalog-model';

/**
 * The images a component runs, comma separated (ghcr.io/owner/app-api:<tag>,ghcr.io/owner/app-web:<tag>): the
 * catalog of refresquito-services writes it with the tag deployed in its stage. Their SBOMs are what the tab shows.
 */
export const ANNOTATION_SBOM_IMAGES = 'refresquito.io/sbom-images';

export function sbomImages(entity: Entity): string[] {
  return (entity.metadata.annotations?.[ANNOTATION_SBOM_IMAGES] ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export const isSbomAvailable = (entity: Entity): boolean => sbomImages(entity).length > 0;
