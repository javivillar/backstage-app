import { classify, entityPath } from './classify';
import { classicPathFor } from './ConsoleShell';
import { isConsolePath } from '../paths';

const entity = (annotations: Record<string, string>, labels: Record<string, string>) => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'x', annotations, labels },
});

describe('classify', () => {
  it('tells business applications from Refresquito services', () => {
    expect(classify(entity({ 'refresquito.io/application': 'petstore' }, { 'refresquito.io/segment': 'business-support' }))).toBe('business');
    expect(classify(entity({}, { 'refresquito.io/segment': 'iam' }))).toBe('service');
    expect(classify(entity({}, {}))).toBe('other');
  });
  it('builds the classic path of an entity', () => {
    expect(entityPath(entity({}, {}))).toBe('/catalog/default/component/x');
  });
});

describe('paths', () => {
  it('knows the routes of the console', () => {
    expect(isConsolePath('/console')).toBe(true);
    expect(isConsolePath('/console/clusters/nato')).toBe(true);
    expect(isConsolePath('/consoles')).toBe(false);
    expect(isConsolePath('/catalog')).toBe(false);
  });
  it('maps console pages to classic pages', () => {
    expect(classicPathFor('/console/cluster')).toBe('/topology');
    expect(classicPathFor('/console/clusters/nato')).toBe('/home');
    expect(classicPathFor('/console')).toBe('/home');
  });
});
