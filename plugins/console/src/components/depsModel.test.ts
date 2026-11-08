import type { Entity } from '@backstage/catalog-model';
import { buildGraph, layerOf, reach, stackLayout } from './depsModel';

const c = (name: string, extra: Partial<Entity['metadata']> = {}, relations: Entity['relations'] = []): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name, namespace: 'default', ...extra },
  spec: { type: 'service' },
  relations,
});

describe('depsModel', () => {
  const petstore = c('petstore-oneke', { annotations: { 'refresquito.io/application': 'petstore' } }, [
    { type: 'dependsOn', targetRef: 'component:default/iam-oneke' },
    { type: 'consumesApi', targetRef: 'api:default/orders' },
  ]);
  const iam = c('iam-oneke', { labels: { 'refresquito.io/segment': 'iam' } });
  const orders = c('orders-oneke', { annotations: { 'refresquito.io/application': 'orders' } }, [{ type: 'providesApi', targetRef: 'api:default/orders' }]);
  const graph = buildGraph([petstore, iam, orders], () => ({ tone: 'ok', label: 'Healthy' }));

  it('puts each element in its layer', () => {
    expect(layerOf(petstore)).toBe('biz');
    expect(layerOf(iam)).toBe('sec');
    expect(layerOf(c('gravitee-oneke'))).toBe('dat');
    expect(layerOf(c('something', { labels: { 'refresquito.io/segment': 'observability' } }))).toBe('obs');
  });

  it('gives business and development services their bands, with the old catalog too', () => {
    const sys: Entity = { apiVersion: 'backstage.io/v1alpha1', kind: 'System', metadata: { name: 'petstore', namespace: 'default' }, spec: { type: 'business-service' } };
    expect(layerOf(sys)).toBe('biz');
    expect(layerOf({ ...c('python-framework-3-2'), spec: { type: 'framework-line' } })).toBe('fwk');
    expect(layerOf({ ...c('python-framework'), spec: { type: 'library', system: 'framework-development' } })).toBe('fwk');
    expect(layerOf({ ...c('iam-oneke'), spec: { type: 'platform-service', system: 'iam' } })).toBe('sec');
  });

  it('links a business service to its application and the application to its instances', () => {
    const sys: Entity = { apiVersion: 'backstage.io/v1alpha1', kind: 'System', metadata: { name: 'petstore', namespace: 'default' }, spec: { type: 'business-service' }, relations: [{ type: 'hasPart', targetRef: 'component:default/petstore' }, { type: 'hasPart', targetRef: 'component:default/petstore-oneke' }] };
    const repo: Entity = { ...c('petstore', {}, [{ type: 'hasSubcomponent', targetRef: 'component:default/petstore-oneke' }]), spec: { type: 'business-application' } };
    const segment: Entity = { apiVersion: 'backstage.io/v1alpha1', kind: 'System', metadata: { name: 'iam', namespace: 'default' }, spec: { type: 'network-segment' } };
    const g = buildGraph([sys, repo, petstore, segment], () => ({ tone: 'ok', label: 'Healthy' }));
    expect(g.nodes.map(n => n.id)).toEqual(['system:default/petstore', 'component:default/petstore', 'component:default/petstore-oneke']);
    expect(g.links.map(l => `${l.source}>${l.target}:${l.label}`)).toEqual([
      'system:default/petstore>component:default/petstore:application',
      'component:default/petstore>component:default/petstore-oneke:instance',
    ]);
  });

  it('links dependsOn and the APIs consumed to their provider, and counts dependents', () => {
    expect(graph.links).toEqual([
      { source: 'component:default/petstore-oneke', target: 'component:default/iam-oneke', label: 'depends on', type: 'dep' },
      { source: 'component:default/petstore-oneke', target: 'component:default/orders-oneke', label: 'orders API', type: 'api' },
    ]);
    expect(graph.nodes.find(n => n.id === 'component:default/iam-oneke')?.deg).toBe(1);
  });

  it('reaches downstream only when asked', () => {
    expect([...reach('component:default/iam-oneke', graph.links, 99, true).keys()]).toEqual(['component:default/iam-oneke']);
    expect(reach('component:default/iam-oneke', graph.links, 99, false).has('component:default/orders-oneke')).toBe(true);
  });

  it('places every node on the height of its layer', () => {
    const pos = stackLayout(graph.nodes, graph.links);
    expect(pos.get('component:default/petstore-oneke')!.y).toBe(pos.get('component:default/orders-oneke')!.y);
    expect(pos.get('component:default/iam-oneke')!.y).toBeGreaterThan(pos.get('component:default/petstore-oneke')!.y);
  });
});
