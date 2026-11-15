import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useCallback, useEffect, useState } from 'react';
import type { Tone } from './components/ui';

/**
 * The pull requests the console opened for a kind of change and where each one stands (backend consolePulls.ts):
 * GET /api/<plugin><path> → { pulls }. The pages that change something by pull request show them until applied.
 */
export type PullState = 'checking' | 'failed' | 'conflict' | 'ready' | 'open' | 'merged' | 'closed';
/** cancel: who reads the list may cancel this one (still open, and theirs or of a kind of change they may make) */
export type ChangePull = { number: number; title: string; url: string; branch: string; created: string; by?: string; state: PullState; closed?: string; cancel?: boolean };

export const PULL_TONE: Record<PullState, Tone> = { checking: 'info', failed: 'neg', conflict: 'neg', ready: 'pos', open: 'neu', merged: 'pos', closed: 'neu' };
/** still waiting for someone: not merged, not closed */
export const isPending = (p: Pick<ChangePull, 'state'>) => p.state !== 'merged' && p.state !== 'closed';

/** The pending ones first, then the rest; each group newest first. Only the branches that start with `match`. */
export function orderPulls(pulls: ChangePull[], match?: string): ChangePull[] {
  const when = (p: ChangePull) => Date.parse(p.closed ?? p.created) || 0;
  return pulls.filter(p => !match || p.branch.startsWith(match)).sort((a, b) => Number(isPending(b)) - Number(isPending(a)) || when(b) - when(a));
}

/** The path that cancels a pull request of a list: /pulls?kind=x → /pulls/12/cancel?kind=x. */
export function cancelPath(path: string, number: number): string {
  const [base, query] = path.split('?');
  return `${base}/${number}/cancel${query ? `?${query}` : ''}`;
}

/** The path that asks the backend to read GitHub again (?fresh=1). */
export const freshPath = (path: string, fresh: boolean) => (fresh ? `${path}${path.includes('?') ? '&' : '?'}fresh=1` : path);

/**
 * The pull requests of a kind; read again when `refresh` changes (after the page opens one). A page must work
 * without them: any failure is an empty list. reload() reads GitHub again (the Refresh button); cancel(n) closes one.
 */
export function usePulls(plugin: string, path: string, refresh?: unknown): { loading: boolean; pulls: ChangePull[]; readAt?: Date; reload: () => void; cancel: (number: number) => Promise<void> } {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; pulls: ChangePull[]; readAt?: Date }>({ loading: true, pulls: [] });
  // asked again by hand: GitHub is read again instead of what the backend kept
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let alive = true;
    setState(s => ({ ...s, loading: true }));
    (async () => {
      const res = await fetch(`${await discovery.getBaseUrl(plugin)}${freshPath(path, asked > 0)}`);
      const body = res.ok ? ((await res.json().catch(() => ({}))) as { pulls?: ChangePull[] }) : {};
      return Array.isArray(body.pulls) ? body.pulls : [];
    })().then(
      pulls => alive && setState({ loading: false, pulls, readAt: new Date() }),
      () => alive && setState({ loading: false, pulls: [] }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, plugin, path, refresh, asked]);
  const reload = useCallback(() => setAsked(n => n + 1), []);
  // closes the pull request and deletes its branch; throws the reason of the backend
  const cancel = useCallback(
    async (number: number) => {
      const res = await fetch(`${await discovery.getBaseUrl(plugin)}${cancelPath(path, number)}`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      setAsked(n => n + 1);
    },
    [discovery, fetch, plugin, path],
  );
  return { ...state, reload, cancel };
}
