import { layerOf } from './layers';
import type { ConsoleClassicPage } from './pages';

const pages: ConsoleClassicPage[] = [
  { id: 'topology', title: 'Topology', layer: 'cluster', classicPath: '/topology', element: null },
  { id: 'create', title: 'Create', layer: 'portal', classicPath: '/create', element: null },
];

it('tells the layer of a console path', () => {
  expect(layerOf('/console/infrastructure/vms')).toBe('infra');
  expect(layerOf('/console/clusters/nato')).toBe('infra');
  expect(layerOf('/console/cluster')).toBe('cluster');
  expect(layerOf('/console/namespaces/x')).toBe('cluster');
  expect(layerOf('/console/topology', pages)).toBe('cluster');
  expect(layerOf('/console/create/templates/x', pages)).toBe('portal');
  expect(layerOf('/console/entity/default/component/petstore')).toBe('portal');
  expect(layerOf('/console/')).toBe('portal');
  // /console/clusterfoo is not the cluster layer
  expect(layerOf('/console/clusterfoo')).toBe('portal');
});
