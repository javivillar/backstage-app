import { classicPathForConsole, consolePathForClassic, stayInConsole, type ConsoleClassicPage } from './pages';
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
    expect(consolePathForClassic('/docs/default/component/petstore/guide/', pages)).toBe('/console/entity/default/component/petstore/docs');
  });

  it('maps console paths back to the classic portal', () => {
    expect(classicPathForConsole('/console/create/templates/default/python-app', pages)).toBe('/create/templates/default/python-app');
    expect(classicPathForConsole('/console/costs', pages)).toBe('/costs');
    expect(classicPathFor('/console/costs', pages)).toBe('/costs');
    expect(classicPathFor('/console/clusters', pages)).toBe('/home');
  });

  it('keeps a navigation of a framed classic page inside the console', () => {
    const tpl = '/create/templates/default/keycloak-create-group';
    expect(stayInConsole('/console/keycloak', tpl, pages)).toBe(`/console${tpl}`);
    expect(stayInConsole('/console/create', '/create/tasks/abc', pages)).toBe('/console/create/tasks/abc');
    // from the classic portal: stays classic
    expect(stayInConsole('/keycloak-manager', tpl, pages)).toBeUndefined();
    expect(stayInConsole('/', '/create', pages)).toBeUndefined();
    // already in the console, or a classic page the console does not show
    expect(stayInConsole('/console/costs', '/console/create', pages)).toBeUndefined();
    expect(stayInConsole('/console/costs', '/topology', pages)).toBeUndefined();
    expect(stayInConsole('/console/create', '/home', pages)).toBeUndefined();
  });
});
