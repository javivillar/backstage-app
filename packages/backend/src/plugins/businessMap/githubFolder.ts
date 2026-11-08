/**
 * The files of a folder of a GitHub repository in ONE GraphQL query (the contents API takes a request per file: a
 * customer with thousands of processes spent the hourly limit of the token of Backstage in minutes). One level (the
 * files of the folder) or two (the files of each subfolder, as catalog/business-map/<namespace>/). A file GitHub gives
 * no text of (over its size limit, isTruncated) is read alone through the contents API.
 */

export type FolderFile = { path: string; text: string };
export type FolderSource = { repo: string; branch: string; token?: string };

/** GitHub limits the token for now (403/429 with no requests left, or a GraphQL RATE_LIMITED). */
export class GitHubRateLimitError extends Error {
  constructor(public readonly at?: string) {
    super(`GitHub limits the requests of the token of Backstage for now: try again ${at ? `after ${at} UTC` : 'within the hour'}.`);
    this.name = 'GitHubRateLimitError';
  }
}

type Blob = { text?: string | null; isTruncated?: boolean };
type Entry = { name: string; type: string; object?: (Blob & { entries?: Entry[] }) | null };

const BLOB = '... on Blob { text isTruncated }';
const queryOf = (depth: 1 | 2) => {
  const inner = depth === 2 ? `entries { name type object { ${BLOB} } }` : '';
  return `query($owner: String!, $name: String!, $expr: String!) { repository(owner: $owner, name: $name) { object(expression: $expr) { ... on Tree { entries { name type object { ${BLOB} ${inner ? `... on Tree { ${inner} }` : ''} } } } } } }`;
};

const headersOf = (token?: string): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

function limited(res: Response): GitHubRateLimitError | undefined {
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if ((res.status === 403 || res.status === 429) && (res.headers.get('x-ratelimit-remaining') === '0' || reset)) {
    return new GitHubRateLimitError(reset ? new Date(reset * 1000).toISOString().slice(11, 16) : undefined);
  }
  return undefined;
}

/** A file alone, through the contents API (raw): for the few GraphQL gives no text of. */
async function readOne(src: FolderSource, path: string, fetchFn: typeof fetch): Promise<string> {
  const res = await fetchFn(`https://api.github.com/repos/${src.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(src.branch)}`, {
    headers: { Accept: 'application/vnd.github.raw', ...headersOf(src.token) },
  });
  const limit = limited(res);
  if (limit) throw limit;
  if (!res.ok) throw new Error(`GitHub answered ${res.status} reading ${src.repo}/${path}`);
  return res.text();
}

/**
 * The .yaml files of a folder (depth 1) or of its subfolders (depth 2), [] when the folder does not exist. Throws
 * GitHubRateLimitError when GitHub limits the token, Error for anything else.
 */
export async function readFolder(src: FolderSource, folder: string, depth: 1 | 2, fetchFn: typeof fetch = fetch): Promise<FolderFile[]> {
  const [owner, name] = src.repo.split('/');
  const res = await fetchFn('https://api.github.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headersOf(src.token) },
    body: JSON.stringify({ query: queryOf(depth), variables: { owner, name, expr: `${src.branch}:${folder}` } }),
  });
  if (!res.ok) {
    const limit = limited(res);
    if (limit) throw limit;
    throw new Error(`GitHub answered ${res.status} reading ${src.repo}/${folder}${res.status === 401 || res.status === 403 ? ' (does the token of Backstage have Contents: read on it?)' : ''}`);
  }
  const body = (await res.json()) as { data?: { repository?: { object?: { entries?: Entry[] } | null } | null }; errors?: Array<{ type?: string; message: string }> };
  if (body.errors?.length) {
    if (body.errors.some(e => e.type === 'RATE_LIMITED')) throw new GitHubRateLimitError();
    throw new Error(`GitHub: ${body.errors.map(e => e.message).join('; ')}`);
  }
  const top = body.data?.repository?.object?.entries ?? [];
  const found: Array<{ path: string; blob?: Blob | null }> = [];
  const yaml = (e: Entry) => e.type === 'blob' && /\.ya?ml$/.test(e.name);
  if (depth === 1) for (const e of top.filter(yaml)) found.push({ path: `${folder}/${e.name}`, blob: e.object });
  else
    for (const dir of top.filter(e => e.type === 'tree'))
      for (const e of (dir.object?.entries ?? []).filter(yaml)) found.push({ path: `${folder}/${dir.name}/${e.name}`, blob: e.object });
  const out: FolderFile[] = [];
  for (const f of found) {
    const text = !f.blob?.isTruncated && typeof f.blob?.text === 'string' ? f.blob.text : await readOne(src, f.path, fetchFn);
    out.push({ path: f.path, text });
  }
  return out;
}
