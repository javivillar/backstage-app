import { catalogPathForConsole, consolePathForCatalog, isConsolePath } from './paths';
import { classicPathFor } from './components/ConsoleShell';

describe('paths', () => {
  it('recognises the console routes', () => {
    expect(isConsolePath('/console')).toBe(true);
    expect(isConsolePath('/console/entity/default/component/x')).toBe(true);
    expect(isConsolePath('/consoles')).toBe(false);
  });

  it('maps classic entity pages into the console and back', () => {
    expect(consolePathForCatalog('/catalog/default/component/petstore')).toBe('/console/entity/default/component/petstore');
    expect(consolePathForCatalog('/catalog/default/component/petstore/ci-cd')).toBe('/console/entity/default/component/petstore/ci-cd');
    expect(consolePathForCatalog('/catalog')).toBeUndefined();
    expect(consolePathForCatalog('/catalog-graph')).toBeUndefined();
    expect(catalogPathForConsole('/console/entity/default/api/petstore-api/definition')).toBe('/catalog/default/api/petstore-api/definition');
    expect(catalogPathForConsole('/console/clusters')).toBeUndefined();
  });

  it('opens the same thing in the classic view', () => {
    expect(classicPathFor('/console/entity/default/component/petstore')).toBe('/catalog/default/component/petstore');
    expect(classicPathFor('/console/cluster')).toBe('/topology');
    expect(classicPathFor('/console/clusters')).toBe('/home');
  });
});
