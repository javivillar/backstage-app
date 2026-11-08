import { Entity, entityKindSchemaValidator, getCompoundEntityRef, parseEntityRef } from '@backstage/catalog-model';
import { CatalogProcessor, CatalogProcessorEmit, LocationSpec, processingResult } from '@backstage/plugin-catalog-node';

/**
 * The kinds of the business map (apiVersion refresquito.io/v1alpha1): BusinessProcess and ReferenceModel. Their
 * schemas, and the processor that validates them and emits their relations:
 *   BusinessProcess  ownedBy/ownerOf its owner, partOf/hasPart its Domain, dependsOn/dependencyOf each entry, and,
 *                    for a sub-process, partOf/hasPart its parent process (spec.parentProcess)
 * Owner and dependsOn without a namespace are in `default` (the Groups and the business services live there, while a
 * process lives in a customer namespace); the domain and the parent process without a namespace are in the
 * process's own namespace. A sub-process may leave out its criticality: it inherits the one of its parent.
 */

export const API_VERSION = 'refresquito.io/v1alpha1';
const DURATION = '^[0-9]+\\s*(m|h|d|w|y)$';

export const businessProcessSchema = {
  $schema: 'http://json-schema.org/draft-07/schema',
  $id: 'BusinessProcessV1alpha1',
  description: 'A business process of a business domain, with its continuity requirement and what it depends on.',
  allOf: [
    { $ref: 'Entity' },
    {
      type: 'object',
      required: ['spec'],
      properties: {
        apiVersion: { enum: [API_VERSION] },
        kind: { enum: ['BusinessProcess'] },
        spec: {
          type: 'object',
          required: ['owner', 'domain'],
          // a top process says its criticality; a sub-process may inherit it from its parent
          if: { not: { required: ['parentProcess'] } },
          then: { required: ['criticality'] },
          properties: {
            owner: { type: 'string', minLength: 1 },
            domain: { type: 'string', minLength: 1 },
            parentProcess: { type: 'string', minLength: 1 },
            criticality: { enum: ['critical', 'important', 'standard'] },
            rpo: { type: 'string', pattern: DURATION },
            rto: { type: 'string', pattern: DURATION },
            retention: { type: 'string', pattern: DURATION },
            classification: { type: 'string', minLength: 1 },
            dependsOn: { type: 'array', items: { type: 'string', minLength: 1 } },
          },
        },
      },
    },
  ],
};

export const referenceModelSchema = {
  $schema: 'http://json-schema.org/draft-07/schema',
  $id: 'ReferenceModelV1alpha1',
  description: 'A reference model of business processes (APQC PCF, the Refresquito template or a customer own model).',
  allOf: [
    { $ref: 'Entity' },
    {
      type: 'object',
      required: ['spec'],
      properties: {
        apiVersion: { enum: [API_VERSION] },
        kind: { enum: ['ReferenceModel'] },
        spec: {
          type: 'object',
          required: ['source', 'namespace'],
          properties: {
            source: { enum: ['apqc', 'customer', 'template'] },
            industry: { type: 'string', minLength: 1 },
            version: { type: 'string', minLength: 1 },
            namespace: { type: 'string', minLength: 1 },
            supportCategories: { type: 'array', items: { type: 'string', minLength: 1 } },
          },
        },
      },
    },
  ],
};

const validators = [entityKindSchemaValidator(businessProcessSchema), entityKindSchemaValidator(referenceModelSchema)];

/** True for a valid entity of these kinds, false for another kind; throws with what is wrong for an invalid one. */
export function validateBusinessMapEntity(entity: Entity): boolean {
  return validators.some(v => v(entity) === entity);
}

type Ref = { kind: string; namespace: string; name: string };
export type BusinessMapRelation = { source: Ref; type: string; target: Ref };

/** The relations of a BusinessProcess (both directions); [] for anything else. */
export function relationsOf(entity: Entity): BusinessMapRelation[] {
  if (entity.apiVersion !== API_VERSION || entity.kind !== 'BusinessProcess') return [];
  const self = getCompoundEntityRef(entity);
  const spec = (entity.spec ?? {}) as { owner?: string; domain?: string; parentProcess?: string; dependsOn?: string[] };
  const out: BusinessMapRelation[] = [];
  const both = (target: string | undefined, context: { defaultKind: string; defaultNamespace: string }, outgoing: string, incoming: string) => {
    if (!target) return;
    const t = parseEntityRef(target, context);
    const ref = { kind: t.kind, namespace: t.namespace, name: t.name };
    out.push({ source: self, type: outgoing, target: ref }, { source: ref, type: incoming, target: self });
  };
  both(spec.owner, { defaultKind: 'Group', defaultNamespace: 'default' }, 'ownedBy', 'ownerOf');
  both(spec.domain, { defaultKind: 'Domain', defaultNamespace: self.namespace }, 'partOf', 'hasPart');
  both(spec.parentProcess, { defaultKind: 'BusinessProcess', defaultNamespace: self.namespace }, 'partOf', 'hasPart');
  for (const d of spec.dependsOn ?? []) both(d, { defaultKind: 'System', defaultNamespace: 'default' }, 'dependsOn', 'dependencyOf');
  return out;
}

export class BusinessMapProcessor implements CatalogProcessor {
  getProcessorName(): string {
    return 'BusinessMapProcessor';
  }

  async validateEntityKind(entity: Entity): Promise<boolean> {
    return validateBusinessMapEntity(entity);
  }

  async postProcessEntity(entity: Entity, _location: LocationSpec, emit: CatalogProcessorEmit): Promise<Entity> {
    for (const r of relationsOf(entity)) emit(processingResult.relation(r));
    return entity;
  }
}
