import type { Entity } from '@backstage/catalog-model';
import { BusinessMapProcessor, relationsOf, validateBusinessMapEntity } from './kinds';

const bp = (spec: Record<string, unknown>): Entity => ({
  apiVersion: 'refresquito.io/v1alpha1',
  kind: 'BusinessProcess',
  metadata: { name: 'manage-repairs', namespace: 'example-customer', title: 'Manage repairs' },
  spec: { owner: 'group:default/maintenance', domain: 'after-sales', criticality: 'critical', ...spec },
});

describe('validation', () => {
  it('accepts a valid process and reference model', () => {
    expect(validateBusinessMapEntity(bp({ rpo: '15m', rto: '4h', retention: '30y', dependsOn: ['system:default/petstore'] }))).toBe(true);
    const model: Entity = {
      apiVersion: 'refresquito.io/v1alpha1',
      kind: 'ReferenceModel',
      metadata: { name: 'example-customer-business-model' },
      spec: { source: 'customer', namespace: 'example-customer' },
    };
    expect(validateBusinessMapEntity(model)).toBe(true);
  });
  it('is false for other kinds', () => {
    expect(validateBusinessMapEntity({ apiVersion: 'backstage.io/v1alpha1', kind: 'Component', metadata: { name: 'x' }, spec: {} })).toBe(false);
  });
  it('throws on a wrong criticality, a missing domain or a bad duration', () => {
    expect(() => validateBusinessMapEntity(bp({ criticality: 'high' }))).toThrow();
    expect(() => validateBusinessMapEntity(bp({ domain: undefined }))).toThrow();
    expect(() => validateBusinessMapEntity(bp({ rpo: '15 minutes' }))).toThrow();
  });
});

describe('sub-processes', () => {
  it('a sub-process may leave out its criticality; a top process may not', () => {
    expect(validateBusinessMapEntity(bp({ criticality: undefined, parentProcess: 'manage-repairs-top' }))).toBe(true);
    expect(() => validateBusinessMapEntity(bp({ criticality: undefined }))).toThrow();
    expect(() => validateBusinessMapEntity(bp({ parentProcess: '' }))).toThrow();
  });
  it('is part of its parent process (in its own namespace by default)', () => {
    const r = relationsOf(bp({ parentProcess: 'plan-repairs' }));
    expect(r.filter(x => x.source.name === 'manage-repairs' && x.type === 'partOf').map(x => `${x.target.kind.toLowerCase()}:${x.target.namespace}/${x.target.name}`)).toEqual([
      'domain:example-customer/after-sales',
      'businessprocess:example-customer/plan-repairs',
    ]);
    expect(r.filter(x => x.source.name === 'plan-repairs').map(x => x.type)).toEqual(['hasPart']);
  });
});

describe('relations', () => {
  it('owner and dependsOn default to the namespace default, the domain to its own', () => {
    const r = relationsOf(bp({ owner: 'maintenance', dependsOn: ['petstore', 'component:default/shop-oneke'] }));
    const out = r.filter(x => x.source.name === 'manage-repairs').map(x => `${x.type} ${x.target.kind.toLowerCase()}:${x.target.namespace}/${x.target.name}`);
    expect(out).toEqual([
      'ownedBy group:default/maintenance',
      'partOf domain:example-customer/after-sales',
      'dependsOn system:default/petstore',
      'dependsOn component:default/shop-oneke',
    ]);
    expect(r.filter(x => x.target.name === 'manage-repairs').map(x => x.type)).toEqual(['ownerOf', 'hasPart', 'dependencyOf', 'dependencyOf']);
  });
  it('the processor emits them', async () => {
    const emitted: unknown[] = [];
    await new BusinessMapProcessor().postProcessEntity(bp({}), { type: 'url', target: 'x' }, r => emitted.push(r));
    expect(emitted).toHaveLength(4);
  });
});
