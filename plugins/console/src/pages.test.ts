import { classicPathForConsole, consolePathForClassic, type ConsoleClassicPage } from './pages';
import { classicPathFor } from './components/ConsoleShell';

const pages: ConsoleClassicPage[] = [
  { id: 'create', title: 'Create', layer: 'portal', classicPath: '/create', nested: true, element: null },
  { id: 'costs', title: 'Costs', layer: 'portal', classicPath: '/costs', element: null },
];

describe('classic pages in the console', () => {
  it('maps classic paths into the console', () => {
    expect(consolePathForClassic('/create', pages)).toBe('/console/create');
    expect(consolePathForClassic('/create/templates/default/python-app', pages)).toBe('/console/create/templates/default/python-app');
    expect(consolePathForClassic('/costs/', pages)).toBe('/console/costs');
    expect(consolePathForClassic('/costs/other', pages)).toBeUndefined();
    expect(consolePathForClassic('/catalog/default/component/petstore', pages)).toBe('/console/entity/default/component/petstore');
    expect(consolePathForClassic('/docs', pages)).toBeUndefined();
  });

  it('maps console paths back to the classic portal', () => {
    expect(classicPathForConsole('/console/create/templates/default/python-app', pages)).toBe('/create/templates/default/python-app');
    expect(classicPathForConsole('/console/costs', pages)).toBe('/costs');
    expect(classicPathFor('/console/costs', pages)).toBe('/costs');
    expect(classicPathFor('/console/clusters', pages)).toBe('/home');
  });
});
