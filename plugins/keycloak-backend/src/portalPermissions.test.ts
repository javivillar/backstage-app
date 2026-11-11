import { accessOf, AREAS, isProductAdmin, permissionsOf, rolesOf, templatesOf, type RoleId } from './portalPermissions';

const area = (id: string) => {
  const found = AREAS.find(a => a.id === id);
  if (!found) throw new Error(`no area ${id}`);
  return found;
};
const access = (id: string, roles: RoleId[]) => accessOf(area(id), roles);

describe('portal permissions', () => {
  it('reads the roles of someone from their groups', () => {
    expect(rolesOf(new Set(['backstage-viewer']))).toEqual(['viewer']);
    expect(rolesOf(new Set(['backstage-editor', 'business-architect']))).toEqual(['editor', 'architect']);
    expect(rolesOf(new Set(['superset-admin']))).toEqual(['product']);
    expect(rolesOf(new Set(['supportlead']))).toEqual(['support', 'product']);
    expect(rolesOf(new Set(['backstage-admin']))).toEqual(['admin']);
    expect(rolesOf(new Set(['some-team']))).toEqual([]);
  });

  it('knows the administrators of a product', () => {
    expect(isProductAdmin('activepieces-admin')).toBe(true);
    expect(isProductAdmin('continuity-officer')).toBe(true);
    expect(isProductAdmin('backstage-admin')).toBe(false);
    expect(isProductAdmin('cnoe-admin')).toBe(false);
    expect(isProductAdmin('superset-editor')).toBe(false);
  });

  it('lets only who creates applications see Create', () => {
    expect(access('create', ['viewer'])).toBe('hidden');
    expect(access('create', [])).toBe('hidden');
    expect(access('create', ['architect'])).toBe('hidden');
    expect(access('create', ['editor'])).toBe('manage');
    expect(access('create', ['admin'])).toBe('manage');
  });

  it('gives each area to its role and leaves it readable when everyone sees it', () => {
    expect(access('business', ['architect'])).toBe('manage');
    expect(access('business', ['continuity'])).toBe('read');
    expect(access('continuity', ['continuity'])).toBe('manage');
    expect(access('continuity', ['viewer'])).toBe('read');
    expect(access('security', ['security'])).toBe('manage');
    expect(access('security', ['editor'])).toBe('hidden');
    expect(access('support', ['support'])).toBe('manage');
    expect(access('costs', ['editor'])).toBe('read');
    expect(access('costs', ['viewer'])).toBe('hidden');
    expect(access('access', ['product'])).toBe('manage');
    expect(access('access', ['viewer'])).toBe('hidden');
    expect(access('newframework', ['editor'])).toBe('hidden');
    expect(access('operations', ['product'])).toBe('hidden');
    expect(access('roles', [])).toBe('read');
  });

  it('gives the administrators of the portal everything', () => {
    expect(AREAS.every(a => accessOf(a, ['admin']) === 'manage')).toBe(true);
  });

  it('describes the table with the groups of each role', () => {
    const mine = permissionsOf(['editor']);
    expect(mine.areas.find(a => a.id === 'create')).toEqual({ id: 'create', access: 'manage', scope: undefined, manage: ['backstage-editor'], view: ['backstage-editor'] });
    expect(mine.areas.find(a => a.id === 'manage')?.manage).toEqual(['<product>-admin', 'backstage-editor']);
    expect(mine.areas.find(a => a.id === 'business')?.view).toBe('all');
  });

  it('keeps the templates for who has a role in their area', () => {
    expect(templatesOf(['viewer'])).toEqual({ business: false, others: false });
    expect(templatesOf(['architect'])).toEqual({ business: true, others: false });
    expect(templatesOf(['editor'])).toEqual({ business: false, others: true });
    expect(templatesOf(['product'])).toEqual({ business: false, others: true });
    expect(templatesOf(['admin'])).toEqual({ business: true, others: true });
  });
});
