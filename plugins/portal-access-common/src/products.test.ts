import { accessToArea, managersOf, managesArea } from './permissions';
import { administersProduct, groupNames, isPortalAdmin, productAdminGroups } from './products';

const refs = (...groups: string[]) => ['user:default/ana', ...groups.map(g => `group:default/${g}`)];

describe('who administers a product', () => {
  it('reads the groups of the ownership refs', () => {
    expect([...groupNames(['user:default/ana', 'group:default/Superset-Admin'])]).toEqual(['superset-admin']);
  });

  it('names the administrator group of a product', () => {
    expect(productAdminGroups('superset-oneke')).toEqual(['superset-admin']);
    expect(productAdminGroups('alfrescodms-oneke')).toEqual(['alfrescodms-admin']);
    expect(productAdminGroups('animalshelter')).toEqual(['animalshelter-admin']);
    // the name does not tell
    expect(productAdminGroups('support')).toEqual(['supportlead']);
    expect(productAdminGroups('iam-oneke')).toEqual([]);
  });

  it('lets the administrators of a product and of the portal administer it', () => {
    expect(administersProduct('superset-oneke', refs('superset-admin'))).toBe(true);
    expect(administersProduct('superset-oneke', refs('backstage-admin'))).toBe(true);
    expect(administersProduct('superset-oneke', refs('datahub-admin', 'backstage-editor'))).toBe(false);
    expect(administersProduct('superset-oneke', refs())).toBe(false);
  });

  it('keeps Keycloak for the administrators of the portal', () => {
    expect(administersProduct('iam-oneke', refs('iam-admin', 'keycloak-admin'))).toBe(false);
    expect(administersProduct('iam-oneke', refs('backstage-admin'))).toBe(true);
    expect(isPortalAdmin(refs('cnoe-admin'))).toBe(false);
  });
});

describe('who changes an area', () => {
  it('gives the business map to the business architects and the portal administrators', () => {
    expect(managersOf('business')).toEqual(['business-architect', 'backstage-admin']);
    expect(managesArea('business', refs('business-architect'))).toBe(true);
    expect(managesArea('business', refs('backstage-admin'))).toBe(true);
    expect(managesArea('business', refs('backstage-editor'))).toBe(false);
    expect(accessToArea('business', refs('backstage-editor'))).toBe('read');
  });

  it('refuses an area the table does not have', () => {
    expect(() => managersOf('nowhere')).toThrow('no area nowhere');
  });
});
