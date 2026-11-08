import type { Entity } from '@backstage/catalog-model';
import type { MapData, MapProcess } from '../../businessMap';

/**
 * A made-up customer for the tests of the dashboard models: two top domains (one with a subdomain), four processes
 * and three business services on two platform services and three framework lines.
 */
const rel = (type: string, ...targets: string[]) => targets.map(targetRef => ({ type, targetRef }));
const component = (name: string, type: string, annotations: Record<string, string> = {}, relations: Entity['relations'] = [], lifecycle?: string): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name, namespace: 'default', annotations },
  spec: lifecycle ? { type, lifecycle } : { type },
  relations,
});
const system = (name: string): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'System',
  metadata: { name, namespace: 'default' },
  spec: { type: 'business-service' },
  relations: rel('hasPart', `component:default/${name}`),
});
const app = (name: string, ...instances: string[]) => component(name, 'business-application', {}, rel('hasSubcomponent', ...instances.map(i => `component:default/${i}`)));

export const CATALOG: Entity[] = [
  system('maintenance'),
  app('maintenance', 'maintenance-oneke', 'maintenance-dev-oneke'),
  component('maintenance-oneke', 'application-instance', { 'refresquito.io/stage': 'pro', 'refresquito.io/sbom-images': 'img/m:1, img/m-web:1' }, rel('dependsOn', 'resource:default/maintenance-bucket', 'component:default/python-framework-3-2')),
  component('maintenance-dev-oneke', 'application-instance', { 'refresquito.io/stage': 'dev' }, rel('dependsOn', 'component:default/iam-oneke')),
  { apiVersion: 'backstage.io/v1alpha1', kind: 'Resource', metadata: { name: 'maintenance-bucket', namespace: 'default' }, spec: { type: 's3-bucket' }, relations: rel('dependsOn', 'component:default/seaweedfs-oneke') },
  component('seaweedfs-oneke', 'platform-service', { 'refresquito.io/sla-tier': 'silver', 'refresquito.io/sla-rpo': '24h', 'refresquito.io/sla-rto': '4h' }),
  component('iam-oneke', 'platform-service', { 'refresquito.io/sla-tier': 'gold', 'refresquito.io/sla-rpo': '15 min', 'refresquito.io/sla-rto': '1 h' }),
  component('python-framework-3-2', 'framework-line', { 'refresquito.io/supported-until': '2027-04-28' }, [], 'production'),
  component('python-framework-2-0', 'framework-line', { 'refresquito.io/supported-until': '2027-04-16' }, [], 'deprecated'),
  component('python-framework-3-3', 'framework-line', { 'refresquito.io/supported-until': 'while it is the latest line of the latest major version' }, [], 'production'),
  system('logistics'),
  app('logistics', 'logistics-oneke'),
  component('logistics-oneke', 'application-instance', { 'refresquito.io/stage': 'pro' }, rel('dependsOn', 'component:default/iam-oneke', 'component:default/python-framework-2-0')),
  system('personnel'),
  app('personnel', 'personnel-oneke'),
  component('personnel-oneke', 'application-instance', { 'refresquito.io/stage': 'pro' }, rel('dependsOn', 'component:default/iam-oneke', 'component:default/python-framework-3-3')),
];

const proc = (name: string, title: string, domain: string, criticality: MapProcess['criticality'], rpo: string, rto: string, dependsOn: string[], extra: Partial<MapProcess> = {}): MapProcess => ({
  ref: `businessprocess:occar/${name}`,
  title,
  domain: `domain:occar/${domain}`,
  owner: 'group:occar/maintenance',
  criticality,
  requirement: { rpo, rto, from: { rpo: 'default', rto: 'default' } },
  dependsOn,
  result: 'unknown',
  gaps: [],
  services: [],
  ...extra,
});

export const MAP: MapData = {
  namespaces: ['occar'],
  models: [],
  domains: [
    { ref: 'domain:occar/service-after-sales', title: 'Service after sales' },
    { ref: 'domain:occar/maintenance', title: 'Maintenance and repair', parent: 'domain:occar/service-after-sales' },
    { ref: 'domain:occar/it', title: 'Information technology' },
  ],
  processes: [
    proc('repair', 'Manage repair', 'maintenance', 'critical', '15m', '4h', ['system:default/maintenance'], { processKey: 'repair-flow', result: 'gap' }),
    proc('spares', 'Manage spare parts', 'service-after-sales', 'important', '4h', '24h', ['system:default/logistics'], { result: 'meets' }),
    proc('access', 'Grant access', 'it', 'critical', '15m', '1h', ['system:default/personnel'], { processKey: 'access' }),
    proc('onboard', 'Onboard staff', 'it', 'standard', '24h', '72h', [], { owner: '' }),
  ],
};

/** 2026-11-08: python-framework-3-2 ends in under 6 months */
export const NOW = Date.parse('2026-11-08T00:00:00Z');
