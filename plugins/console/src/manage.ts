import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useCallback, useEffect, useState } from 'react';

/**
 * The client of /api/manage (packages/backend/src/plugins/manage.ts): Manage through git. Every create, update and
 * delete of a Manage page is a pull request on the file that declares the object, never a write to the product.
 */

export type ManageAction = 'create' | 'update' | 'delete';
export type ManageOwner = { kind: 'application'; name: string } | { kind: 'platform' };
/** An application (or the platform) whose objects a person may see and, with canWrite, change. */
export type OwnerView = { kind: 'application' | 'platform'; name: string; title: string; owner?: string; canWrite: boolean };
export type ChangeBody = {
  service: string;
  object: string;
  action: ManageAction;
  owner: ManageOwner;
  id?: string;
  spec?: Record<string, unknown>;
  reason?: string;
  dryRun?: boolean;
};
export type ChangeAnswer = { pull?: { number: number; url: string }; file: string; diff: string; summary: string };
/** A Manage pull request still open: the object it changes. */
export type PendingChange = { number: number; title: string; url: string; created: string; service?: string; object?: string; id?: string; action?: ManageAction; owner?: ManageOwner };

/** A refusal of the backend: its message and, for a 422, what is wrong with each field. */
export class ManageError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: string[] = [],
  ) {
    super(message);
  }
}

export const ownerKey = (o: ManageOwner) => (o.kind === 'platform' ? 'platform' : `application:${o.name}`);
export const ownerOf = (v: OwnerView): ManageOwner => (v.kind === 'platform' ? { kind: 'platform' } : { kind: 'application', name: v.name });

function useManageFetch() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  return useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(`${await discovery.getBaseUrl('manage')}${path}`, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ManageError(body.error ?? `${res.status} ${res.statusText}`, res.status, body.errors ?? []);
      return body as T;
    },
    [discovery, fetch],
  );
}

/** POST /changes: dryRun answers the diff; without it, the pull request. */
export function useManageChange() {
  const get = useManageFetch();
  return useCallback((body: ChangeBody) => get<ChangeAnswer>('/changes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), [get]);
}

type Loaded<T> = { loading: boolean; data?: T; error?: string; reload: () => void };

function useLoad<T>(path: string): Loaded<T> {
  const get = useManageFetch();
  const [n, setN] = useState(0);
  const [state, setState] = useState<{ loading: boolean; data?: T; error?: string }>({ loading: true });
  useEffect(() => {
    let alive = true;
    setState(s => ({ ...s, loading: true }));
    get<T>(path).then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [get, path, n]);
  return { ...state, reload: () => setN(x => x + 1) };
}

/** The applications (and the platform) of the application picker. */
export const useManageOwners = () => useLoad<OwnerView[]>('/owners');
/** The open Manage pull requests of a service. */
export const useManagePending = (service: string) => useLoad<PendingChange[]>(`/pending?service=${encodeURIComponent(service)}`);

/** The pending change of one object, to show "pending change #n" on its row. */
export const pendingFor = (pending: PendingChange[] | undefined, object: string, id: string) => pending?.find(p => p.object === object && p.id === id);
