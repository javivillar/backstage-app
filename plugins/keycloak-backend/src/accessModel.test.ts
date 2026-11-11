import { adminGroupsOf, administers, groupNames, lastAdministrator, mayChange, productsOf, type Caller, type KcGroup } from './accessModel';

const group = (name: string, component?: string, extra: Record<string, string[]> = {}): KcGroup => ({
  id: `id-${name}`,
  name,
  attributes: component ? { 'refresquito.component': [component], ...extra } : undefined,
});

const REALM: KcGroup[] = [
  group('activepieces-admin', 'activepieces-oneke', { 'refresquito.kind': ['role'], 'refresquito.grants': ['Activepieces: administrator'] }),
  group('activepieces-editor', 'activepieces-oneke'),
  group('grafana-activepieces-viewers', 'observability-oneke'),
  group('grafana-nodes-viewers', 'observability-oneke'),
  group('prometheus-admin', 'observability-oneke'),
  group('iris-admin', 'dfir-iris-oneke'),
  group('iris-analyst', 'dfir-iris-oneke'),
  group('backstage-admin', 'cnoe-oneke'),
  group('argocd-admin', 'cnoe-oneke'),
  group('cnoe-admin', 'cnoe-oneke'),
  group('headlamp-admin', 'headlamp-oneke'),
  group('supportlead', 'support'),
  group('supportteam', 'support'),
  group('animalsheltervets', 'animalshelter'),
  group('admin'),
];

const caller = (groups: string[], portalAdmin = false): Caller => ({ ref: 'user:default/ana', groups: new Set(groups), portalAdmin });
const product = (component: string) => {
  const found = productsOf(REALM).find(p => p.component === component);
  if (!found) throw new Error(`no product ${component}`);
  return found;
};

describe('access administration rules', () => {
  it('groups the realm by product and leaves out what has no component', () => {
    const names = productsOf(REALM).map(p => p.component);
    expect(names).toEqual(['activepieces-oneke', 'animalshelter', 'cnoe-oneke', 'dfir-iris-oneke', 'headlamp-oneke', 'observability-oneke', 'support']);
    expect(product('animalshelter').kind).toBe('application');
    expect(product('activepieces-oneke').kind).toBe('service');
  });

  it('shows the Grafana groups of a service with that service', () => {
    const ap = product('activepieces-oneke');
    expect(ap.groups.map(g => g.name)).toEqual(['activepieces-admin', 'activepieces-editor', 'grafana-activepieces-viewers']);
    expect(ap.groups[2].from).toBe('observability-oneke');
    // no component nodes-oneke: the group stays with Grafana
    expect(product('observability-oneke').groups.map(g => g.name)).toEqual(['grafana-nodes-viewers', 'prometheus-admin']);
  });

  it('finds the administrator group of a product', () => {
    expect(product('activepieces-oneke').adminGroups).toEqual(['activepieces-admin']);
    // not named after the component, but the only -admin
    expect(product('dfir-iris-oneke').adminGroups).toEqual(['iris-admin']);
    // set by hand
    expect(product('cnoe-oneke').adminGroups).toEqual(['backstage-admin']);
    expect(product('support').adminGroups).toEqual(['supportlead']);
    // only the portal administrators
    expect(product('observability-oneke').adminGroups).toEqual([]);
    expect(product('animalshelter').adminGroups).toEqual([]);
    // a borrowed Grafana group never makes administrators
    expect(adminGroupsOf('x-oneke', ['a-admin', 'b-admin'])).toEqual([]);
    expect(adminGroupsOf('x-oneke', ['a-admin', 'b-admin'], { admins: { 'x-oneke': ['b-admin', 'gone'] }, portalOnly: [] })).toEqual(['b-admin']);
  });

  it('lets the administrators of a product, the owners of an application and the portal administrators in', () => {
    expect(administers(product('activepieces-oneke'), caller(['activepieces-admin']))).toBe(true);
    expect(administers(product('activepieces-oneke'), caller(['activepieces-editor']))).toBe(false);
    expect(administers(product('dfir-iris-oneke'), caller(['activepieces-admin']))).toBe(false);
    expect(administers(product('dfir-iris-oneke'), caller([], true))).toBe(true);
    expect(administers(product('animalshelter'), caller(['shelter-team']), ['Shelter-Team'])).toBe(true);
    expect(administers(product('animalshelter'), caller(['other']), ['shelter-team'])).toBe(false);
    // the owner of a Component named like a service gets nothing from it
    expect(administers(product('activepieces-oneke'), caller(['shelter-team']), ['shelter-team'])).toBe(false);
  });

  it('keeps the far-reaching groups for the portal administrators', () => {
    const headlamp = product('headlamp-oneke').groups[0];
    expect(headlamp.portalOnly).toBe(true);
    expect(mayChange(headlamp, caller(['headlamp-admin']))).toBe(false);
    expect(mayChange(headlamp, caller([], true))).toBe(true);
    expect(mayChange(product('activepieces-oneke').groups[0], caller(['activepieces-admin']))).toBe(true);
  });

  it('never leaves a product without an administrator', () => {
    const ap = product('activepieces-oneke');
    expect(lastAdministrator(ap, 'activepieces-admin', 'ana', { 'activepieces-admin': ['ana'] })).toMatch(/last administrator/);
    expect(lastAdministrator(ap, 'activepieces-admin', 'ana', { 'activepieces-admin': ['ana', 'luis'] })).toBeUndefined();
    expect(lastAdministrator(ap, 'activepieces-editor', 'ana', { 'activepieces-admin': ['ana'] })).toBeUndefined();
  });

  it('reads the groups of the caller from the ownership refs', () => {
    expect([...groupNames(['user:default/ana', 'group:default/Superset-Admin', 'group:other/x'])]).toEqual(['superset-admin', 'x']);
  });
});
