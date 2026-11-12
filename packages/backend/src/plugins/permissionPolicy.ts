import { createBackendModule } from '@backstage/backend-plugin-api';
import { catalogConditions, createCatalogConditionalDecision } from '@backstage/plugin-catalog-backend/alpha';
import { AuthorizeResult, isResourcePermission, type PolicyDecision } from '@backstage/plugin-permission-common';
import type { PermissionPolicy, PolicyQuery, PolicyQueryUser } from '@backstage/plugin-permission-node';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';
import { BUSINESS_TEMPLATE_TAG, groupNames, rolesOf, templatesOf, type RoleId } from '@internal/backstage-plugin-keycloak-backend';

/**
 * The permission policy of the portal. Everything is allowed, as before, except reading the scaffolder templates
 * from the catalog: a template is only there for who has a role in its area (the one table of permissions,
 * plugins/portal-access-common permissions.ts). The scaffolder reads a template with the credentials of who asks,
 * so someone without the role neither lists it nor runs it, whatever link they open.
 *
 * - templates of the business map (tag business-map): business-architect;
 * - every other template (new applications, the self-service of each product): backstage-editor and the
 *   administrators of a product;
 * - backstage-admin: all of them. Backend services (no user) too.
 */

const ALLOW: PolicyDecision = { result: AuthorizeResult.ALLOW };
const TEMPLATE = catalogConditions.isEntityKind({ kinds: ['Template'] });
const BUSINESS = catalogConditions.hasMetadata({ key: 'tags', value: BUSINESS_TEMPLATE_TAG });

/** What someone with these roles may read of the catalog: everything ('all'), or the entities matching the criteria. */
export function readable(roles: RoleId[]) {
  const { business, others } = templatesOf(roles);
  if (business && others) return 'all' as const;
  if (business) return { anyOf: [{ not: TEMPLATE }, BUSINESS] as [object, object] };
  if (others) return { anyOf: [{ not: TEMPLATE }, { not: BUSINESS }] as [object, object] };
  return { not: TEMPLATE };
}

export class RefresquitoPermissionPolicy implements PermissionPolicy {
  async handle(request: PolicyQuery, user?: PolicyQueryUser): Promise<PolicyDecision> {
    const { permission } = request;
    if (!user || permission.name !== 'catalog.entity.read' || !isResourcePermission(permission, 'catalog-entity')) return ALLOW;
    const criteria = readable(rolesOf(groupNames(user.info.ownershipEntityRefs)));
    if (criteria === 'all') return ALLOW;
    return createCatalogConditionalDecision(permission, criteria as Parameters<typeof createCatalogConditionalDecision>[1]);
  }
}

export const refresquitoPermissionPolicy = createBackendModule({
  pluginId: 'permission',
  moduleId: 'refresquito-policy',
  register(reg) {
    reg.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy(new RefresquitoPermissionPolicy());
      },
    });
  },
});
