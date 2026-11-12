import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useCallback, useEffect, useState } from 'react';

/**
 * The client of /api/keycloak-manager/access (plugins/keycloak-backend accessRoutes.ts): access administration. The
 * administrators of a product put existing people in its Keycloak groups; the backend decides who may do what.
 */

export type Person = { username: string; name: string; email?: string };
export type ProductSummary = { component: string; kind: 'service' | 'application'; groups: number; adminGroups: string[] };
export type GroupView = {
  name: string;
  kind?: string;
  grants?: string;
  classification?: string;
  stages: string[];
  /** its members administer the product */
  admin: boolean;
  /** only the administrators of the portal change it */
  portalOnly: boolean;
  /** the component it is tagged with, when it is another one (the Grafana groups of a service) */
  from?: string;
  canChange: boolean;
};
export type GroupWithMembers = GroupView & { members: Person[] };
export type AccessChange = { at: string; actor: string; action: 'add' | 'remove'; username: string; group: string; component: string };
export type ProductDetail = { component: string; kind: 'service' | 'application'; adminGroups: string[]; groups: GroupWithMembers[]; changes: AccessChange[]; recorded: boolean };
export type PersonAccess = { person: Person; hub?: string; groups: Array<GroupView & { component: string }> };

/** The name of a product as people say it: superset-oneke → superset. */
export const productTitle = (component: string) => component.replace(/-oneke$/, '');

/** How many different people are in these groups. */
export const peopleIn = (groups: GroupWithMembers[]) => new Set(groups.flatMap(g => g.members.map(m => m.username))).size;

/** The people matching a search that are not yet in the group. */
export const candidates = (found: Person[], members: Person[]) => {
  const inside = new Set(members.map(m => m.username));
  return found.filter(p => !inside.has(p.username));
};

export function useAccessFetch() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  return useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(`${await discovery.getBaseUrl('keycloak-manager')}/access${path}`, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      return body as T;
    },
    [discovery, fetch],
  );
}

type Loaded<T> = { loading: boolean; data?: T; error?: string; reload: () => void };

function useLoad<T>(path: string | undefined): Loaded<T> {
  const get = useAccessFetch();
  const [n, setN] = useState(0);
  const [state, setState] = useState<{ loading: boolean; data?: T; error?: string }>({ loading: Boolean(path) });
  useEffect(() => {
    if (!path) {
      setState({ loading: false });
      return undefined;
    }
    let alive = true;
    setState(s => ({ ...s, loading: true, error: undefined }));
    get<T>(path).then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [get, path, n]);
  const reload = useCallback(() => setN(x => x + 1), []);
  return { ...state, reload };
}

/** The products the signed-in person administers. */
export const useAccessProducts = () => useLoad<{ portalAdmin: boolean; products: ProductSummary[] }>('/products');
/** One product: its groups with their members and its last changes. */
export const useAccessProduct = (component?: string) => useLoad<ProductDetail>(component ? `/products/${encodeURIComponent(component)}` : undefined);
/** What one person has in the products the signed-in person administers. */
export const useAccessPerson = (username?: string) => useLoad<PersonAccess>(username ? `/people/${encodeURIComponent(username)}` : undefined);

/** Adds or removes a person in a group; rejects with the reason of the backend. */
export function useAccessChange() {
  const call = useAccessFetch();
  return useCallback(
    (action: 'add' | 'remove', group: string, username: string) =>
      call<{ ok: boolean }>(`/groups/${encodeURIComponent(group)}/members/${encodeURIComponent(username)}`, { method: action === 'add' ? 'PUT' : 'DELETE' }),
    [call],
  );
}

/** Existing people matching a search (2 characters or more). */
export function usePeopleSearch() {
  const call = useAccessFetch();
  return useCallback(async (search: string) => (await call<{ people: Person[] }>(`/people?search=${encodeURIComponent(search)}`)).people, [call]);
}
