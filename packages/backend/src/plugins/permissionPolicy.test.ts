import { AuthorizeResult, createPermission } from '@backstage/plugin-permission-common';
import type { PolicyQueryUser } from '@backstage/plugin-permission-node';
import { RefresquitoPermissionPolicy, readable } from './permissionPolicy';

const read = createPermission({ name: 'catalog.entity.read', attributes: { action: 'read' }, resourceType: 'catalog-entity' });
const other = createPermission({ name: 'scaffolder.task.create', attributes: { action: 'create' } });
const user = (...groups: string[]) => ({ info: { userEntityRef: 'user:default/ana', ownershipEntityRefs: ['user:default/ana', ...groups.map(g => `group:default/${g}`)] } }) as unknown as PolicyQueryUser;
const policy = new RefresquitoPermissionPolicy();
const names = (criteria: unknown) => JSON.stringify(criteria);

describe('permission policy of the portal', () => {
  it('allows everything but the catalog read', async () => {
    expect(await policy.handle({ permission: other }, user())).toEqual({ result: AuthorizeResult.ALLOW });
  });

  it('allows backend services and the administrators of the portal', async () => {
    expect(await policy.handle({ permission: read })).toEqual({ result: AuthorizeResult.ALLOW });
    expect(await policy.handle({ permission: read }, user('backstage-admin'))).toEqual({ result: AuthorizeResult.ALLOW });
  });

  it('hides every template from someone without a role', async () => {
    const decision = await policy.handle({ permission: read }, user('backstage-viewer'));
    expect(decision.result).toBe(AuthorizeResult.CONDITIONAL);
    expect(readable(['viewer'])).toEqual({ not: expect.objectContaining({ rule: 'IS_ENTITY_KIND', params: { kinds: ['Template'] } }) });
  });

  it('gives the templates of the business map to the business architect only', () => {
    const architect = names(readable(['architect']));
    expect(architect).toContain('"anyOf"');
    expect(architect).toContain('"rule":"HAS_METADATA"');
    expect(architect).toContain('"value":"business-map"');
    // the business map rule is not negated for the architect, and is for who only creates applications
    expect(readable(['architect'])).toEqual({ anyOf: [{ not: expect.anything() }, expect.objectContaining({ rule: 'HAS_METADATA' })] });
    expect(readable(['editor'])).toEqual({ anyOf: [{ not: expect.anything() }, { not: expect.objectContaining({ rule: 'HAS_METADATA' }) }] });
    expect(readable(['product'])).toEqual(readable(['editor']));
  });

  it('gives every template to who has both roles', async () => {
    expect(readable(['editor', 'architect'])).toBe('all');
    expect(await policy.handle({ permission: read }, user('backstage-editor', 'business-architect'))).toEqual({ result: AuthorizeResult.ALLOW });
  });
});
