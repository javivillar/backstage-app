import { groupRef, mayUse } from './access';

describe('access', () => {
  it('normalises group names', () => {
    expect(groupRef('Ops-Admin')).toBe('group:default/ops-admin');
    expect(groupRef('group:default/x')).toBe('group:default/x');
  });
  it('denies by default and allows members', () => {
    expect(mayUse(['group:default/backstage-admin'], [])).toBe(false);
    expect(mayUse(['user:default/a', 'group:default/backstage-admin'], ['backstage-admin'])).toBe(true);
    expect(mayUse(['group:default/devs'], ['backstage-admin'])).toBe(false);
  });
});
