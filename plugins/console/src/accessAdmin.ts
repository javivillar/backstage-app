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
      // pending: adding to a group only the portal administrators change waits for a second one (double approval)
      call<{ ok: boolean; pending?: boolean }>(`/groups/${encodeURIComponent(group)}/members/${encodeURIComponent(username)}`, { method: action === 'add' ? 'PUT' : 'DELETE' }),
    [call],
  );
}

/** Existing people matching a search (2 characters or more). */
export function usePeopleSearch() {
  const call = useAccessFetch();
  return useCallback(async (search: string) => (await call<{ people: Person[] }>(`/people?search=${encodeURIComponent(search)}`)).people, [call]);
}

// --- requests of access (accessRoutes.ts /requests) --------------------------------------------------------------

export type RequestState = 'pending' | 'approved' | 'rejected' | 'withdrawn';
export type AccessRequest = {
  id: number;
  at: string;
  requester: string;
  group: string;
  component: string;
  reason: string;
  state: RequestState;
  decidedBy?: string;
  decidedAt?: string;
  answer?: string;
};
export type AskableGroup = {
  name: string;
  kind?: string;
  grants?: string;
  classification?: string;
  admin: boolean;
  member: boolean;
  pending: boolean;
};
export type AskableProduct = {
  component: string;
  kind: 'service' | 'application';
  groups: AskableGroup[];
};
export type AccessRequests = {
  /** what the person may ask for */
  products: AskableProduct[];
  /** their own requests, the most recent first */
  mine: AccessRequest[];
  /** whether they administer a product, and so decide its requests */
  decides: boolean;
  pending: AccessRequest[];
  decided: AccessRequest[];
};

/** What a group is to the person who looks at it: theirs already, asked for, or free to ask for. */
export const askState = (g: AskableGroup): 'member' | 'pending' | 'free' => {
  if (g.member) return 'member';
  return g.pending ? 'pending' : 'free';
};

/** A reason that can be sent: something, and at most 500 characters. */
export const MAX_REASON = 500;
export const validReason = (text: string) =>
  text.trim().length > 0 && text.trim().length <= MAX_REASON;

/** What the person may ask for, their requests, and the ones they decide. */
export const useAccessRequests = () => useLoad<AccessRequests>('/requests');

/** Asks, approves, rejects or withdraws; each rejects with the reason of the backend. */
export function useRequestActions() {
  const call = useAccessFetch();
  const json = (body: object): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    ask: (group: string, reason: string) =>
      call<AccessRequest>('/requests', json({ group, reason: reason.trim() })),
    approve: (id: number) =>
      call<{ ok: boolean }>(`/requests/${id}/approval`, { method: 'POST' }),
    reject: (id: number, reason: string) =>
      call<{ ok: boolean }>(
        `/requests/${id}/rejection`,
        json({ reason: reason.trim() }),
      ),
    withdraw: (id: number) =>
      call<{ ok: boolean }>(`/requests/${id}`, { method: 'DELETE' }),
  };
}
