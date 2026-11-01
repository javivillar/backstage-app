import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useCallback } from 'react';
import { useClusterGet } from './namespace';

export type ActionRecord = { at: string; user: string; action: string; target: string; result: 'done' | 'failed'; message?: string };
export type ActionsInfo = { allowed: boolean; configured: boolean; groups: string[]; log: ActionRecord[] };

/** Whether the user may act (console.actions.groups), the last actions, and how to run one (through Argo CD). */
export function useActions() {
  const info = useClusterGet<ActionsInfo>('/actions', 0);
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const run = useCallback(
    async (action: 'sync' | 'restart', body: Record<string, string>) => {
      const res = await fetch(`${await discovery.getBaseUrl('cluster')}/actions/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const answer = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(answer.error ?? `${res.status} ${res.statusText}`);
      info.reload();
    },
    [discovery, fetch, info],
  );
  return { ...info, run };
}
