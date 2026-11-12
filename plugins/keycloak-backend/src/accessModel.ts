import { groupNames, namedAdminGroup, PORTAL_ONLY, PRODUCT_ADMIN_GROUPS } from '@internal/backstage-plugin-portal-access-common';
import { tagsOf } from './security';

export { groupNames };

/**
 * Access administration (console › Portal › Manage › Access administration): who may put people in the Keycloak
 * groups of each product. The rules, kept pure for the tests; accessRoutes.ts reads Keycloak and applies them.
 *
 * - A product is a Component of the security tags (refresquito.component): a Refresquito service (superset-oneke) or
 *   a business application (animalshelter). Its groups are the ones tagged with it.
 * - The Grafana groups of a service (grafana-<service>-viewers / -editors, tagged observability-oneke) are shown with
 *   that service: they give access to its dashboards, so its administrator decides who gets them.
 * - The administrators of a product are the members of its administrator group (<product>-admin, or the one in
 *   ADMIN_GROUPS). They add and remove people in the groups of the product, other administrators included.
 * - The administrators of the portal (backstage-admin) administer every product, and only they change the groups
 *   of PORTAL_ONLY, which reach far beyond one product (cluster-admin, every bucket, the portal itself).
 * - The owner group of a business application (spec.owner of its Component) administers its groups.
 * - A product is never left without an administrator.
 */

export type KcGroup = { id: string; name: string; attributes?: Record<string, string[]> };

export type AccessGroup = {
  id: string;
  name: string;
  /** refresquito.kind: access, role, team, data */
  kind?: string;
  grants?: string;
  classification?: string;
  stages: string[];
  /** its members administer the product */
  admin: boolean;
  /** only the administrators of the portal change it */
  portalOnly: boolean;
  /** tagged with another component (the Grafana groups of a service) */
  from?: string;
};

export type Product = {
  component: string;
  kind: 'service' | 'application';
  groups: AccessGroup[];
  /** names of the groups whose members administer it */
  adminGroups: string[];
};

export type Caller = {
  /** user:default/ana */
  ref: string;
  /** names of the caller's groups, lower case */
  groups: Set<string>;
  portalAdmin: boolean;
};

export type AccessRules = {
  /** component → the groups whose members administer it (replaces the rule of the name) */
  admins: Record<string, string[]>;
  /** groups only the administrators of the portal change */
  portalOnly: string[];
};

/** The rules of the portal (portal-access-common), unless the configuration sets others. */
export const DEFAULT_RULES: AccessRules = { admins: PRODUCT_ADMIN_GROUPS, portalOnly: PORTAL_ONLY };

const OBSERVABILITY = 'observability-oneke';
const GRAFANA_OF = /^grafana-(.+)-(?:editors|viewers)$/;

export const kindOf = (component: string): Product['kind'] => (component.endsWith('-oneke') ? 'service' : 'application');

/** The component a group is shown with: its own, or for the Grafana groups of a service, that service. */
export function productOf(group: KcGroup, components: Set<string>): string | undefined {
  const own = tagsOf(group.attributes).component;
  if (own !== OBSERVABILITY) return own;
  const service = GRAFANA_OF.exec(group.name)?.[1];
  if (!service) return own;
  return [`${service}-oneke`, service].find(c => c !== OBSERVABILITY && components.has(c)) ?? own;
}

/** The groups whose members administer `component`, among the groups tagged with it. */
export function adminGroupsOf(component: string, own: string[], rules: AccessRules = DEFAULT_RULES): string[] {
  const set = rules.admins[component];
  if (set) return set.filter(g => own.includes(g));
  const exact = namedAdminGroup(component);
  if (own.includes(exact)) return [exact];
  const named = own.filter(g => g.endsWith('-admin'));
  return named.length === 1 ? named : [];
}

/** Every product of the realm, with its groups, by component name. */
export function productsOf(groups: KcGroup[], rules: AccessRules = DEFAULT_RULES): Product[] {
  const components = new Set(groups.map(g => tagsOf(g.attributes).component).filter((c): c is string => Boolean(c)));
  const by = new Map<string, KcGroup[]>();
  for (const g of groups) {
    const component = productOf(g, components);
    if (component) by.set(component, [...(by.get(component) ?? []), g]);
  }
  const portalOnly = new Set(rules.portalOnly);
  return [...by.entries()]
    .map(([component, list]) => {
      const own = list.filter(g => tagsOf(g.attributes).component === component).map(g => g.name);
      const adminGroups = adminGroupsOf(component, own, rules);
      return {
        component,
        kind: kindOf(component),
        adminGroups,
        groups: list
          .map(g => {
            const tags = tagsOf(g.attributes);
            return {
              id: g.id,
              name: g.name,
              kind: tags.kind,
              grants: tags.grants,
              classification: tags.classification,
              stages: tags.stages,
              admin: adminGroups.includes(g.name),
              portalOnly: portalOnly.has(g.name),
              from: tags.component === component ? undefined : tags.component,
            };
          })
          .sort((a, b) => Number(b.admin) - Number(a.admin) || a.name.localeCompare(b.name)),
      };
    })
    .sort((a, b) => a.component.localeCompare(b.component));
}

/**
 * Whether the caller administers the product: a portal administrator, a member of one of its administrator groups,
 * or (a business application) a member of the group that owns it in the catalog (`owners`, group names).
 */
export function administers(product: Product, caller: Caller, owners: string[] = []): boolean {
  if (caller.portalAdmin) return true;
  if (product.adminGroups.some(g => caller.groups.has(g.toLowerCase()))) return true;
  return product.kind === 'application' && owners.some(g => caller.groups.has(g.toLowerCase()));
}

/** Whether the caller may add or remove people in this group of a product they administer. */
export const mayChange = (group: AccessGroup, caller: Caller): boolean => caller.portalAdmin || !group.portalOnly;

/**
 * Why `username` cannot leave `group`, or undefined when they can: the administrator groups of the product would be
 * left with nobody. `adminMembers`: who is in each administrator group of the product.
 */
export function lastAdministrator(product: Product, group: string, username: string, adminMembers: Record<string, string[]>): string | undefined {
  if (!product.adminGroups.includes(group)) return undefined;
  const left = new Set<string>();
  for (const [g, members] of Object.entries(adminMembers)) {
    for (const m of members) if (g !== group || m !== username) left.add(m);
  }
  if (left.size > 0) return undefined;
  return `${username} is the last administrator of ${product.component}: add another one first.`;
}
