import { type Entity, stringifyEntityRef } from '@backstage/catalog-model';

/**
 * The page of a business service (System of type business-service): its business application (the repo Component),
 * its instances by stage (pro first) and the platform blocks each instance declares. Pure, from the parts of the System.
 */
export const STAGES = ['pro', 'pre', 'dev'];

export type Instance = { entity: Entity; stage: string; blocks: Entity[] };
export type BusinessServiceView = { applications: Entity[]; instances: Instance[]; others: Entity[]; names: string[] };

const APPLICATION = 'refresquito.io/application';
const lower = (s: string) => s.toLocaleLowerCase('en-US');

/** The stage of an instance: its annotation, else its name (<app>-<stage>-oneke), else pro. */
export function stageOf(e: Entity): string {
  const stage = e.metadata.annotations?.['refresquito.io/stage'];
  if (stage) return stage;
  const m = e.metadata.name.match(/-(dev|pre)-oneke$/);
  return m ? m[1] : 'pro';
}

/**
 * An instance <app>[-<stage>]-oneke: its type, or (a catalog before the types) a Component of an application that is
 * not one of its Spring services.
 */
export function isInstance(e: Entity): boolean {
  if (e.kind !== 'Component') return false;
  const type = e.spec?.type;
  if (type === 'application-instance') return true;
  if (type === 'business-application') return false;
  const ann = e.metadata.annotations ?? {};
  return !!ann[APPLICATION] && !ann['refresquito.io/service'] && e.metadata.name.endsWith('-oneke');
}

export function businessServiceView(parts: Entity[]): BusinessServiceView {
  const instanceEntities = parts.filter(isInstance);
  const names = [...new Set(instanceEntities.map(e => e.metadata.annotations?.[APPLICATION]).filter((x): x is string => !!x))].sort();
  const isApplication = (e: Entity) =>
    e.kind === 'Component' && (e.spec?.type === 'business-application' || (!e.spec?.type && names.includes(e.metadata.name)));
  const resources = new Map(parts.filter(e => e.kind === 'Resource').map(e => [lower(stringifyEntityRef(e)), e]));
  const used = new Set<string>();
  const rank = (s: string) => (STAGES.indexOf(s) < 0 ? 99 : STAGES.indexOf(s));
  const instances = instanceEntities
    .map(entity => {
      const blocks = (entity.relations ?? [])
        .filter(r => r.type === 'dependsOn' && resources.has(lower(r.targetRef)))
        .map(r => {
          used.add(lower(r.targetRef));
          return resources.get(lower(r.targetRef))!;
        })
        .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
      return { entity, stage: stageOf(entity), blocks };
    })
    .sort((a, b) => rank(a.stage) - rank(b.stage) || a.entity.metadata.name.localeCompare(b.entity.metadata.name));
  const applications = parts.filter(isApplication);
  const others = parts.filter(e => !isInstance(e) && !isApplication(e) && !used.has(lower(stringifyEntityRef(e))));
  return { applications, instances, others, names };
}

/**
 * Whether a System is a business service: its type, or (before the types) a System without a type whose instances all
 * belong to one application (a segment System such as business-systems holds several).
 */
export const isBusinessService = (system: Entity, view: BusinessServiceView) =>
  system.spec?.type === 'business-service' || (!system.spec?.type && view.instances.length > 0 && view.names.length === 1);
