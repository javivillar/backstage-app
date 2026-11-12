/**
 * Who administers each product of the portal. A product is a Component of the security tags of Keycloak
 * (refresquito.component): a Refresquito service (superset-oneke) or a business application (animalshelter).
 *
 * - The administrators of a product are the members of its administrator group: <product>-admin (superset-admin for
 *   superset-oneke), or the groups of PRODUCT_ADMIN_GROUPS when the name does not tell.
 * - The administrators of the portal (PORTAL_ADMIN_GROUPS) administer every product, and only they change the groups
 *   of PORTAL_ONLY, which reach far beyond one product (cluster-admin, every bucket, the portal itself).
 *
 * Callers pass the ownership refs of the signed-in person (group:default/superset-admin): Backstage builds them from
 * the Keycloak groups at sign-in, so a change of group applies at the next sign-in.
 */

/** The groups whose members administer the portal, and with it every product. */
export const PORTAL_ADMIN_GROUPS = ['backstage-admin'];

/** Products whose administrator group the name does not tell. An empty list: only the portal administrators. */
export const PRODUCT_ADMIN_GROUPS: Record<string, string[]> = {
  'cnoe-oneke': ['backstage-admin'],
  'continuity-oneke': ['continuity-officer'],
  'secassistant-oneke': ['security-team'],
  'observability-oneke': [],
  'iam-oneke': [],
  support: ['supportlead'],
};

/** Groups that give far more than a product: Kubernetes cluster-admin, Argo CD admin, every bucket, the portal. */
export const PORTAL_ONLY = ['admin', 'backstage-admin', 'cnoe-admin', 'argocd-admin', 'headlamp-admin', 's3-admins'];

/** The names of the groups in ownership refs (group:default/superset-admin), lower case. */
export function groupNames(ownershipEntityRefs: string[]): Set<string> {
  const names = new Set<string>();
  for (const ref of ownershipEntityRefs) {
    const m = /^group:[^/]+\/(.+)$/i.exec(ref);
    if (m) names.add(m[1].toLowerCase());
  }
  return names;
}

const inAny = (groups: string[], ownershipEntityRefs: string[]): boolean => {
  const mine = groupNames(ownershipEntityRefs);
  return groups.some(g => mine.has(g.toLowerCase()));
};

/** Whether the person administers the portal. */
export const isPortalAdmin = (ownershipEntityRefs: string[]): boolean => inAny(PORTAL_ADMIN_GROUPS, ownershipEntityRefs);

/** The name of the administrator group of a product by the rule of the name: superset-oneke → superset-admin. */
export const namedAdminGroup = (component: string): string => `${component.replace(/-oneke$/, '')}-admin`;

/** The groups whose members administer `component`, besides the administrators of the portal. */
export function productAdminGroups(component: string, admins: Record<string, string[]> = PRODUCT_ADMIN_GROUPS): string[] {
  return admins[component] ?? [namedAdminGroup(component)];
}

/**
 * Whether the person administers the product: an administrator of the portal, or a member of one of its
 * administrator groups. What every Manage page of a service means by "admin": sees and changes every object of the
 * service, not only their own.
 */
export function administersProduct(component: string, ownershipEntityRefs: string[], admins: Record<string, string[]> = PRODUCT_ADMIN_GROUPS): boolean {
  return isPortalAdmin(ownershipEntityRefs) || inAny(productAdminGroups(component, admins), ownershipEntityRefs);
}
