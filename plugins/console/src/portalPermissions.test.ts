import { accessTo, areaOfPath, canOpen, type PortalPermissions } from './portalPermissions';

const reader: PortalPermissions = {
  roles: ['viewer'],
  admins: ['backstage-admin'],
  areas: [
    { id: 'catalogue', access: 'read', manage: ['backstage-editor'], view: 'all' },
    { id: 'create', access: 'hidden', manage: ['backstage-editor'], view: ['backstage-editor'] },
    { id: 'business', access: 'read', manage: ['business-architect'], view: 'all' },
    { id: 'manage', access: 'hidden', manage: ['<product>-admin'], view: ['<product>-admin'] },
  ],
};

describe('portal permissions in the console', () => {
  it('finds the area of a console path', () => {
    expect(areaOfPath('/console')).toBe('catalogue');
    expect(areaOfPath('/console/')).toBe('catalogue');
    expect(areaOfPath('/console/entity/default/component/petstore/security')).toBe('catalogue');
    expect(areaOfPath('/console/create/templates/default/python-app')).toBe('create');
    expect(areaOfPath('/console/development/spring-framework-app')).toBe('create');
    expect(areaOfPath('/console/new-framework')).toBe('newframework');
    expect(areaOfPath('/console/frameworks/python-3.2')).toBe('frameworks');
    expect(areaOfPath('/console/business-map/process/new')).toBe('business');
    expect(areaOfPath('/console/continuity/pki-oneke')).toBe('continuity');
    expect(areaOfPath('/console/app/support')).toBe('support');
    expect(areaOfPath('/console/manage/keycloak?tab=groups')).toBe('manage');
    expect(areaOfPath('/console/access-administration')).toBe('access');
    expect(areaOfPath('/console/sec-assistant')).toBe('security');
    expect(areaOfPath('/console/ops-assistant')).toBe('operations');
  });

  it('leaves the cluster and the infrastructure alone', () => {
    expect(areaOfPath('/console/cluster')).toBeUndefined();
    expect(areaOfPath('/console/infrastructure/vms')).toBeUndefined();
    // /console/continuity is an area, /console/continuityx is not
    expect(areaOfPath('/console/createx')).toBeUndefined();
  });

  it('hides what the person cannot use and nothing else', () => {
    expect(canOpen(reader, '/console/create')).toBe(false);
    expect(canOpen(reader, '/console/manage/superset')).toBe(false);
    expect(canOpen(reader, '/console/business-map')).toBe(true);
    expect(canOpen(reader, '/console/cluster')).toBe(true);
    // an area the table does not list
    expect(canOpen(reader, '/console/costs')).toBe(true);
  });

  it('hides nothing while the table is not known', () => {
    expect(canOpen(undefined, '/console/create')).toBe(true);
    expect(accessTo(undefined, 'create')).toBe('read');
  });
});
