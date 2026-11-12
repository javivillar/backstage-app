import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';

/**
 * What the signed-in person may do in the portal, from the one table of permissions of the backend
 * (GET /api/keycloak-manager/permissions, plugins/keycloak-backend portalPermissions.ts). The console uses it to show
 * only the menu entries and pages a person can use; the backend refuses on its own whatever is shown here.
 */

export type Access = 'manage' | 'read' | 'hidden';
export type AreaAccess = { id: string; access: Access; scope?: 'owned' | 'product'; manage: string[]; view: 'all' | string[] };
export type PortalPermissions = { roles: string[]; admins: string[]; areas: AreaAccess[] };

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** [area, the console paths of the portal that belong to it]; the first match wins. */
const AREA_PATHS: Array<[string, string[]]> = [
  ['create', ['/console/create', '/console/development']],
  ['newframework', ['/console/new-framework']],
  ['frameworks', ['/console/frameworks', '/console/heatmap']],
  ['business', ['/console/business-map', '/console/data-continuity']],
  ['continuity', ['/console/continuity']],
  ['costs', ['/console/costs']],
  ['security', ['/console/sec-assistant']],
  ['operations', ['/console/ops-assistant']],
  ['assistants', ['/console/assistants', '/console/functional-assistant', '/console/architect-assistant', '/console/developer-assistant']],
  ['support', ['/console/app', '/console/monitoring', '/console/resolution-groups']],
  ['access', ['/console/access-administration']],
  ['requests', ['/console/access-requests']],
  ['evidence', ['/console/control-evidence']],
  ['roles', ['/console/roles-permissions']],
  ['manage', ['/console/manage']],
  ['catalogue', ['/console/entity', '/console/apis', '/console/docs', '/console/quality', '/console/dependencies']],
];

/** The area of the permissions table a console path belongs to; undefined for the pages it does not cover (cluster, infrastructure). */
export function areaOfPath(path: string): string | undefined {
  const p = path.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/console';
  if (p === '/console') return 'catalogue';
  return AREA_PATHS.find(([, bases]) => bases.some(b => under(p, b)))?.[0];
}

/** The access to an area; while the table is not known (loading, or it could not be read) nothing is hidden. */
export function accessTo(permissions: PortalPermissions | undefined, area: string | undefined): Access {
  if (!permissions || !area) return 'read';
  return permissions.areas.find(a => a.id === area)?.access ?? 'read';
}

/** Whether a menu entry or a page is shown to this person. */
export const canOpen = (permissions: PortalPermissions | undefined, path: string) => accessTo(permissions, areaOfPath(path)) !== 'hidden';

type State = { loading: boolean; permissions?: PortalPermissions; error?: string };
const Ctx = createContext<State>({ loading: false });

/** Reads the permissions of the signed-in person once, for the whole console. */
export const PortalPermissionsProvider = ({ children }: PropsWithChildren) => {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<State>({ loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`${await discovery.getBaseUrl('keycloak-manager')}/permissions`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      return body as PortalPermissions;
    })().then(
      permissions => alive && setState({ loading: false, permissions }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch]);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
};

export function usePortalPermissions() {
  const state = useContext(Ctx);
  return useMemo(
    () => ({
      ...state,
      access: (area: string) => accessTo(state.permissions, area),
      canOpen: (path: string) => canOpen(state.permissions, path),
    }),
    [state],
  );
}
