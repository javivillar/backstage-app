import { groupNames, PORTAL_ADMIN_GROUPS, PRODUCT_ADMIN_GROUPS } from './products';

/**
 * The one table of permissions of the portal: what each role sees and changes in each area. A role is one or more
 * Keycloak groups, so people get it in Access administration. Read by:
 *
 * - GET /api/keycloak-manager/permissions: what the signed-in person may do, for the console to show only the menu
 *   entries and pages they can use, and for the page Roles and permissions;
 * - the permission policy of the backend (packages/backend/src/plugins/permissionPolicy.ts), which keeps the
 *   templates of an area from who has no role in it, whatever the pages show.
 *
 * The modules ask this table instead of keeping their own groups: managesArea('business', refs) in the business
 * map, administersProduct('superset-oneke', refs) (products.ts) in the Manage pages of a service.
 */

export type RoleId = 'viewer' | 'editor' | 'architect' | 'continuity' | 'security' | 'support' | 'product' | 'admin';
export type Access = 'manage' | 'read' | 'hidden';

/** The Keycloak groups of each role. `product` is the administrators of any product: see isProductAdmin. */
export const ROLE_GROUPS: Record<Exclude<RoleId, 'product'>, string[]> = {
  viewer: ['backstage-viewer'],
  editor: ['backstage-editor'],
  architect: ['business-architect'],
  continuity: ['continuity-officer'],
  security: ['security-team'],
  support: ['supportlead', 'supportteam'],
  admin: PORTAL_ADMIN_GROUPS,
};

export type Area = {
  id: string;
  /** who sees it: everyone signed in, or these roles (who manages it always sees it) */
  view: 'all' | RoleId[];
  /** who changes it, besides the administrators of the portal */
  manage: RoleId[];
  /** what "manage" is limited to, when a role does not manage the whole area */
  scope?: 'owned' | 'product';
};

export const AREAS: Area[] = [
  // what exists and how it is doing; each element is changed by the group that owns it
  { id: 'catalogue', view: 'all', manage: ['editor'], scope: 'owned' },
  // the templates and wizards of a new application
  { id: 'create', view: ['editor'], manage: ['editor'] },
  { id: 'frameworks', view: 'all', manage: [] },
  { id: 'newframework', view: [], manage: [] },
  { id: 'business', view: 'all', manage: ['architect'] },
  { id: 'continuity', view: 'all', manage: ['continuity'] },
  { id: 'security', view: ['security'], manage: ['security'] },
  { id: 'support', view: 'all', manage: ['support'] },
  { id: 'costs', view: ['editor'], manage: [], scope: 'owned' },
  // functional, architect and developer assistants
  { id: 'assistants', view: ['editor', 'architect'], manage: ['editor', 'architect'] },
  // the operations assistant
  { id: 'operations', view: [], manage: [] },
  // the objects of a service: its administrators, and the owners of an application for theirs
  { id: 'manage', view: ['product', 'editor'], manage: ['product', 'editor'], scope: 'product' },
  { id: 'access', view: ['product', 'editor'], manage: ['product', 'editor'], scope: 'product' },
  // asking for a group of a product: everyone; its administrators decide
  { id: 'requests', view: 'all', manage: ['product', 'editor'], scope: 'product' },
  { id: 'roles', view: 'all', manage: [] },
];

/** Groups ending in -admin that administer no product of their own. */
const NOT_PRODUCT_ADMIN = new Set(['backstage-admin', 'cnoe-admin']);
const NAMED_PRODUCT_ADMINS = new Set(
  Object.values(PRODUCT_ADMIN_GROUPS)
    .flat()
    .filter(g => !NOT_PRODUCT_ADMIN.has(g)),
);

/** Whether a group makes its members administrators of a product (superset-admin, supportlead...). */
export const isProductAdmin = (group: string) => !NOT_PRODUCT_ADMIN.has(group) && (group.endsWith('-admin') || NAMED_PRODUCT_ADMINS.has(group));

/** The roles of someone in these groups (names, lower case). */
export function rolesOf(groups: Set<string>): RoleId[] {
  const roles = (Object.keys(ROLE_GROUPS) as Array<Exclude<RoleId, 'product'>>).filter(r => ROLE_GROUPS[r].some(g => groups.has(g)));
  return [...groups].some(isProductAdmin) ? [...roles, 'product'] : roles;
}

export function accessOf(area: Area, roles: RoleId[]): Access {
  if (roles.includes('admin') || area.manage.some(r => roles.includes(r))) return 'manage';
  if (area.view === 'all' || area.view.some(r => roles.includes(r))) return 'read';
  return 'hidden';
}

const groupsOfRole = (role: RoleId): string[] => (role === 'product' ? ['<product>-admin'] : ROLE_GROUPS[role]);

/** The area of the table with this id; an unknown id is a mistake of the caller. */
export function areaOf(id: string): Area {
  const area = AREAS.find(a => a.id === id);
  if (!area) throw new Error(`portal permissions: there is no area ${id}`);
  return area;
}

/** The groups whose members change an area: the ones of the roles that manage it and the portal administrators. */
export const managersOf = (id: string): string[] => [...new Set([...areaOf(id).manage.flatMap(groupsOfRole), ...ROLE_GROUPS.admin])];

/** What the person with these ownership refs may do in an area. */
export const accessToArea = (id: string, ownershipEntityRefs: string[]): Access => accessOf(areaOf(id), rolesOf(groupNames(ownershipEntityRefs)));

/** Whether the person changes an area (a role that manages it, or an administrator of the portal). */
export const managesArea = (id: string, ownershipEntityRefs: string[]): boolean => accessToArea(id, ownershipEntityRefs) === 'manage';

/** What the page Roles and permissions and the console need of the table, for someone with these roles. */
export function permissionsOf(roles: RoleId[]) {
  return {
    roles,
    admins: ROLE_GROUPS.admin,
    areas: AREAS.map(a => ({
      id: a.id,
      access: accessOf(a, roles),
      scope: a.scope,
      manage: a.manage.flatMap(groupsOfRole),
      view: a.view === 'all' ? ('all' as const) : a.view.flatMap(groupsOfRole),
    })),
  };
}

/** The tag of the templates of the business map (backstage-templates): they belong to the area `business`. */
export const BUSINESS_TEMPLATE_TAG = 'business-map';

/**
 * Which scaffolder templates someone with these roles may use: the ones of the business map with the role that
 * manages it, every other one with a role that creates applications or administers a product.
 */
export function templatesOf(roles: RoleId[]): { business: boolean; others: boolean } {
  if (roles.includes('admin')) return { business: true, others: true };
  return { business: roles.includes('architect'), others: roles.includes('editor') || roles.includes('product') };
}
