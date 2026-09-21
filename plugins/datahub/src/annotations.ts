import { Entity } from '@backstage/catalog-model';

// The annotations that link a Backstage entity to DataHub assets
// (BACKSTAGE-DATAHUB-DESIGN.md §2). Kept in sync with plugins/datahub-backend/src/urn.ts.
export const ANNOTATION_DATASET = 'datahub.io/dataset';
export const ANNOTATION_DATA_PRODUCT = 'datahub.io/data-product';
export const ANNOTATION_FLOW = 'datahub.io/flow';

const ALL = [ANNOTATION_DATA_PRODUCT, ANNOTATION_DATASET, ANNOTATION_FLOW];

/** The DataHub URNs an entity points at (a component may have a product AND a flow). */
export function datahubUrns(entity: Entity): string[] {
  const a = entity.metadata.annotations ?? {};
  return ALL.map(k => a[k]).filter((v): v is string => !!v && v.startsWith('urn:li:'));
}

export const isDatahubAvailable = (entity: Entity): boolean => datahubUrns(entity).length > 0;
