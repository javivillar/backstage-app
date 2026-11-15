import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { useEffect, useState } from 'react';
import type { Tone } from './components/ui';

/**
 * The pull requests the console opened for a kind of change and where each one stands (backend consolePulls.ts):
 * GET /api/<plugin><path> → { pulls }. The pages that change something by pull request show them until applied.
 */
export type PullState = 'checking' | 'failed' | 'conflict' | 'ready' | 'open' | 'merged' | 'closed';
export type ChangePull = { number: number; title: string; url: string; branch: string; created: string; by?: string; state: PullState; closed?: string };

export const PULL_TONE: Record<PullState, Tone> = { checking: 'info', failed: 'neg', conflict: 'neg', ready: 'pos', open: 'neu', merged: 'pos', closed: 'neu' };
/** still waiting for someone: not merged, not closed */
export const isPending = (p: Pick<ChangePull, 'state'>) => p.state !== 'merged' && p.state !== 'closed';

/** The pending ones first, then the rest; each group newest first. Only the branches that start with `match`. */
export function orderPulls(pulls: ChangePull[], match?: string): ChangePull[] {
  const when = (p: ChangePull) => Date.parse(p.closed ?? p.created) || 0;
  return pulls.filter(p => !match || p.branch.startsWith(match)).sort((a, b) => Number(isPending(b)) - Number(isPending(a)) || when(b) - when(a));
}

/**
 * The pull requests of a kind; read again when `refresh` changes (after the page opens one). A page must work
 * without them: any failure is an empty list.
 */
export function usePulls(plugin: string, path: string, refresh?: unknown): { loading: boolean; pulls: ChangePull[] } {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; pulls: ChangePull[] }>({ loading: true, pulls: [] });
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`${await discovery.getBaseUrl(plugin)}${path}`);
      const body = res.ok ? ((await res.json().catch(() => ({}))) as { pulls?: ChangePull[] }) : {};
      return Array.isArray(body.pulls) ? body.pulls : [];
    })().then(
      pulls => alive && setState({ loading: false, pulls }),
      () => alive && setState({ loading: false, pulls: [] }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, plugin, path, refresh]);
  return state;
}
