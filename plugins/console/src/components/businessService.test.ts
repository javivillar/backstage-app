import type { Entity } from '@backstage/catalog-model';
import { businessServiceView, isBusinessService, isInstance, stageOf } from './businessService';

const ent = (kind: string, name: string, spec: Record<string, string> = {}, annotations: Record<string, string> = {}, relations: Entity['relations'] = []): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind,
  metadata: { name, namespace: 'default', annotations },
  spec,
  relations,
});
const app = { 'refresquito.io/application': 'petstore' };

describe('business service view', () => {
  const repo = ent('Component', 'petstore', { type: 'business-application', system: 'petstore' });
  const pro = ent('Component', 'petstore-oneke', { type: 'application-instance' }, app, [{ type: 'dependsOn', targetRef: 'resource:default/petstore-db' }, { type: 'dependsOn', targetRef: 'component:default/iam-oneke' }]);
  const dev = ent('Component', 'petstore-dev-oneke', { type: 'application-instance' }, { ...app, 'refresquito.io/stage': 'dev' }, [{ type: 'dependsOn', targetRef: 'resource:default/petstore-dev-db' }]);
  const pre = ent('Component', 'petstore-pre-oneke', { type: 'application-instance' }, app);
  const db = ent('Resource', 'petstore-db', { type: 'database' }, app);
  const devDb = ent('Resource', 'petstore-dev-db', { type: 'database' }, app);
  const loose = ent('Resource', 'petstore-bucket', { type: 's3' }, app);
  const api = ent('API', 'petstore-api', { type: 'openapi' });

  it('tells the stage of an instance', () => {
    expect(stageOf(dev)).toBe('dev');
    expect(stageOf(pre)).toBe('pre');
    expect(stageOf(pro)).toBe('pro');
  });

  it('puts the application, the instances by stage with their blocks, and the rest apart', () => {
    const v = businessServiceView([dev, api, loose, db, pre, repo, pro, devDb]);
    expect(v.applications.map(x => x.metadata.name)).toEqual(['petstore']);
    expect(v.instances.map(i => i.stage)).toEqual(['pro', 'pre', 'dev']);
    expect(v.instances[0].blocks.map(b => b.metadata.name)).toEqual(['petstore-db']);
    expect(v.instances[2].blocks.map(b => b.metadata.name)).toEqual(['petstore-dev-db']);
    expect(v.others.map(x => x.metadata.name)).toEqual(['petstore-api', 'petstore-bucket']);
    expect(v.names).toEqual(['petstore']);
    expect(isBusinessService(ent('System', 'petstore', { type: 'business-service' }), v)).toBe(true);
  });

  it('works with the catalog before the types', () => {
    const oldPro = ent('Component', 'petstore-oneke', { type: 'service' }, app);
    const spring = ent('Component', 'petstore-orders', { type: 'service' }, { ...app, 'refresquito.io/service': 'orders' });
    expect(isInstance(oldPro)).toBe(true);
    expect(isInstance(spring)).toBe(false);
    const v = businessServiceView([oldPro, spring]);
    expect(v.instances.map(i => i.entity.metadata.name)).toEqual(['petstore-oneke']);
    expect(isBusinessService(ent('System', 'petstore'), v)).toBe(true);
    // a segment System holds the instances of several applications: not one business service
    const other = ent('Component', 'orders-oneke', { type: 'service' }, { 'refresquito.io/application': 'orders' });
    expect(isBusinessService(ent('System', 'business-systems'), businessServiceView([oldPro, other]))).toBe(false);
    expect(isBusinessService(ent('System', 'iam', { type: 'network-segment' }), businessServiceView([]))).toBe(false);
  });
});
