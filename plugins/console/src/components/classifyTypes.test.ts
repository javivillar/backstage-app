import type { Entity } from '@backstage/catalog-model';
import { classify, kindOfType, segmentOf, systemName } from './classify';

const e = (kind: string, spec: Record<string, string>, annotations: Record<string, string> = {}, labels: Record<string, string> = {}): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind,
  metadata: { name: 'x', annotations, labels },
  spec,
});

describe('classify by the types of the business map', () => {
  it('reads spec.type first', () => {
    expect(classify(e('System', { type: 'business-service' }))).toBe('business');
    expect(classify(e('Component', { type: 'business-application', system: 'petstore' }))).toBe('business');
    expect(classify(e('Component', { type: 'application-instance', system: 'petstore' }, {}, { 'refresquito.io/segment': 'business-support' }))).toBe('business');
    expect(classify(e('Component', { type: 'platform-service', system: 'iam' }, {}, { 'refresquito.io/segment': 'iam' }))).toBe('service');
    expect(classify(e('Component', { type: 'development-service', system: 'framework-development' }))).toBe('development');
    expect(classify(e('Component', { type: 'framework-line', system: 'framework-development' }))).toBe('development');
    expect(classify(e('System', { type: 'network-segment' }))).toBe('other');
  });

  it('falls back to the annotations and the old Systems with the catalog before the types', () => {
    expect(classify(e('Component', { type: 'service', system: 'business-support' }, { 'refresquito.io/application': 'petstore' }, { 'refresquito.io/segment': 'business-support' }))).toBe('business');
    expect(classify(e('Resource', { type: 'database', system: 'petstore' }, { 'refresquito.io/application': 'petstore' }))).toBe('business');
    expect(classify(e('Component', { type: 'service', system: 'iam' }, {}, { 'refresquito.io/segment': 'iam' }))).toBe('service');
    expect(classify(e('Component', { type: 'website', system: 'business-systems' }))).toBe('business');
    expect(classify(e('Component', { type: 'library', system: 'framework-development' }))).toBe('development');
    expect(classify(e('Component', { type: 'library', system: 'system:default/framework-development' }))).toBe('development');
    expect(classify(e('System', {}))).toBe('other');
  });

  it('knows only the types of the business map', () => {
    expect(kindOfType('platform-service')).toBe('service');
    expect(kindOfType('service')).toBeUndefined();
    expect(kindOfType(undefined)).toBeUndefined();
  });

  it('reads the system and the segment', () => {
    expect(systemName(e('Component', { system: 'system:default/petstore' }))).toBe('petstore');
    expect(systemName(e('Component', { system: 'petstore' }))).toBe('petstore');
    expect(systemName(e('Component', {}))).toBeUndefined();
    expect(segmentOf(e('Component', { system: 'petstore' }, {}, { 'refresquito.io/segment': 'business-support' }))).toBe('business-support');
    expect(segmentOf(e('Component', { system: 'petstore' }, { 'refresquito.io/segment': 'iam' }))).toBe('iam');
    expect(segmentOf(e('Component', { system: 'petstore' }))).toBeUndefined();
  });
});
