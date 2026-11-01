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
