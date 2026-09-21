import { Config } from '@backstage/config';

// Minimal GitHub Issues client for the vocabulary requests (design §9 / open decision §12.5: an ISSUE,
// not a PR or a bespoke form). Uses the token Backstage already has for its GitHub integration.

export interface IssueRef {
  number: number;
  url: string;
}

/** The token of the github.com integration (`integrations.github[].token`), if configured. */
export function githubToken(config: Config): string | undefined {
  const list = config.getOptionalConfigArray('integrations.github') ?? [];
  const gh = list.find(c => (c.getOptionalString('host') ?? 'github.com') === 'github.com');
  return gh?.getOptionalString('token');
}

async function ghFetch<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** An OPEN issue with exactly this title and label, if any (so a repeated request does not duplicate). */
export async function findOpenIssue(token: string, repo: string, label: string, title: string): Promise<IssueRef | undefined> {
  const list = await ghFetch<Array<{ number: number; html_url: string; title: string; pull_request?: unknown }>>(
    token,
    'GET',
    `/repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`,
  );
  const hit = list.find(i => !i.pull_request && i.title === title);
  return hit ? { number: hit.number, url: hit.html_url } : undefined;
}

export async function createIssue(token: string, repo: string, title: string, body: string, labels: string[]): Promise<IssueRef> {
  const r = await ghFetch<{ number: number; html_url: string }>(token, 'POST', `/repos/${repo}/issues`, { title, body, labels });
  return { number: r.number, url: r.html_url };
}
