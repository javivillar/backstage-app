/**
 * The files of a folder of a GitHub repository through GraphQL: the tree in one query, the text of the files in batches
 * and only for the files that changed (the contents API takes a request per file: a customer with thousands of
 * processes spent the hourly limit of the token of Backstage in minutes; their text in one query made GitHub answer
 * 502). One level (the files of the folder) or two (the files of each subfolder, as catalog/business-map/<namespace>/).
 * A file GitHub gives no text of (over its size limit, isTruncated) is read alone through the contents API.
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
type Entry = { name: string; type: string; oid: string; object?: { entries?: Entry[] } | null };

/** The tree without the text of its files: names and blob ids only (the text of ~2000 files in one query made GitHub answer 502). */
const listQuery = (depth: 1 | 2) =>
  `query($owner: String!, $name: String!, $expr: String!) { repository(owner: $owner, name: $name) { object(expression: $expr) { ... on Tree { entries { name type oid ${
    depth === 2 ? 'object { ... on Tree { entries { name type oid } } }' : ''
  } } } } } }`;

/** The text of up to BATCH blobs by their id, one alias each. */
const textQuery = (oids: string[]) =>
  `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${oids
    .map((oid, i) => `b${i}: object(oid: "${oid}") { ... on Blob { text isTruncated } }`)
    .join(' ')} } }`;
const BATCH = 100;
const PARALLEL = 3;

/** The text of each blob already read, by its id: a run reads only the files that changed since the one before. */
const texts = new Map<string, string>();
const CACHE_MAX = 20000;
/** For the tests. */
export const clearFolderCache = () => texts.clear();

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

async function graphql<T>(src: FolderSource, query: string, variables: Record<string, string>, what: string, fetchFn: typeof fetch): Promise<T> {
  const res = await fetchFn('https://api.github.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headersOf(src.token) },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const limit = limited(res);
    if (limit) throw limit;
    throw new Error(`GitHub answered ${res.status} reading ${src.repo}/${what}${res.status === 401 || res.status === 403 ? ' (does the token of Backstage have Contents: read on it?)' : ''}`);
  }
  const body = (await res.json()) as { data?: T; errors?: Array<{ type?: string; message: string }> };
  if (body.errors?.length) {
    if (body.errors.some(e => e.type === 'RATE_LIMITED')) throw new GitHubRateLimitError();
    throw new Error(`GitHub: ${body.errors.map(e => e.message).join('; ')}`);
  }
  return body.data as T;
}

/**
 * The .yaml files of a folder (depth 1) or of its subfolders (depth 2), [] when the folder does not exist: one query
 * for the tree, then the text of the files not read before in batches of BATCH (a run with no change is one query).
 * Throws GitHubRateLimitError when GitHub limits the token, Error for anything else.
 */
export async function readFolder(src: FolderSource, folder: string, depth: 1 | 2, fetchFn: typeof fetch = fetch): Promise<FolderFile[]> {
  const [owner, name] = src.repo.split('/');
  type Listing = { repository?: { object?: { entries?: Entry[] } | null } | null };
  const data = await graphql<Listing>(src, listQuery(depth), { owner, name, expr: `${src.branch}:${folder}` }, folder, fetchFn);
  const top = data?.repository?.object?.entries ?? [];
  const found: Array<{ path: string; oid: string }> = [];
  const yaml = (e: Entry) => e.type === 'blob' && /\.ya?ml$/.test(e.name);
  if (depth === 1) for (const e of top.filter(yaml)) found.push({ path: `${folder}/${e.name}`, oid: e.oid });
  else
    for (const dir of top.filter(e => e.type === 'tree'))
      for (const e of (dir.object?.entries ?? []).filter(yaml)) found.push({ path: `${folder}/${dir.name}/${e.name}`, oid: e.oid });

  const missing = [...new Set(found.map(f => f.oid).filter(oid => !texts.has(oid)))];
  if (texts.size + missing.length > CACHE_MAX) texts.clear();
  const batches: string[][] = [];
  for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH));
  const tooBig = new Set<string>();
  const readBatch = async (oids: string[]) => {
    const got = await graphql<{ repository?: Record<string, Blob | null> | null }>(src, textQuery(oids), { owner, name }, folder, fetchFn);
    oids.forEach((oid, i) => {
      const b = got?.repository?.[`b${i}`];
      if (b && !b.isTruncated && typeof b.text === 'string') texts.set(oid, b.text);
      else tooBig.add(oid);
    });
  };
  for (let i = 0; i < batches.length; i += PARALLEL) await Promise.all(batches.slice(i, i + PARALLEL).map(readBatch));

  const out: FolderFile[] = [];
  for (const f of found) {
    let text = texts.get(f.oid);
    if (text === undefined || tooBig.has(f.oid)) {
      text = await readOne(src, f.path, fetchFn);
      texts.set(f.oid, text);
    }
    out.push({ path: f.path, text });
  }
  return out;
}
