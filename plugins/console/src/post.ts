import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';

/** The answer of a change asked from the console: a pull request to review, or done (committed). */
export type PostAnswer = { ok: boolean; message?: string; pull?: { number: number; url: string } };

/** POST to /api/cluster<path>; throws the backend's reason. */
export function useClusterPost() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  return async (path: string, body: Record<string, string | number>): Promise<PostAnswer> => {
    const res = await fetch(`${await discovery.getBaseUrl('cluster')}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const answer = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(answer.error ?? `${res.status} ${res.statusText}`);
    return answer as PostAnswer;
  };
}
