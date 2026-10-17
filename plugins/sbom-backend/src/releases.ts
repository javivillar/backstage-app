/**
 * The SBOM of a release of GitHub: the file <name>.cdx.json the release workflow of a library attaches to it (the
 * frameworks refresquito-fastapi and refresquito-angular). Read with the token of the GitHub integration.
 */
import { RegistryError } from './registry';

export interface ReleaseRef {
  owner: string;
  repo: string;
  tag: string;
}

/** owner/repo@tag */
export function parseReleaseRef(ref: string): ReleaseRef {
  const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)@([A-Za-z0-9._-]+)$/.exec(ref.trim());
  if (!m) throw new RegistryError(`Not a release (owner/repo@tag): ${ref}`, 400);
  return { owner: m[1], repo: m[2], tag: m[3] };
}

export interface FoundReleaseSbom {
  release: string;
  url: string;
  asset: string;
  published?: string;
  bom: unknown;
}

interface Asset {
  name: string;
  url: string;
  size: number;
}

type Fetch = typeof fetch;

export async function findReleaseSbom(
  ref: string,
  token: string | undefined,
  fetchImpl: Fetch = fetch,
  apiBase = 'https://api.github.com',
  maxBytes = 20 * 1024 * 1024,
): Promise<FoundReleaseSbom | undefined> {
  const { owner, repo, tag } = parseReleaseRef(ref);
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetchImpl(`${apiBase}/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: { Accept: 'application/vnd.github+json', ...auth },
  });
  if (res.status === 404) throw new RegistryError(`There is no release ${tag} of ${owner}/${repo} (or the GitHub token cannot read it)`, 404);
  if (!res.ok) throw new RegistryError(`GitHub answered ${res.status} for the release ${ref}`, 502);
  const release = (await res.json()) as { html_url: string; published_at?: string; assets?: Asset[] };
  const asset = (release.assets ?? []).find(a => a.name.endsWith('.cdx.json'));
  if (!asset) return undefined;
  if (asset.size > maxBytes) throw new RegistryError(`The SBOM is larger than ${maxBytes} bytes`, 413);
  // the asset API answers with a redirect to its storage; fetch drops the Authorization header on that other host
  const file = await fetchImpl(asset.url, { headers: { Accept: 'application/octet-stream', ...auth }, redirect: 'follow' });
  if (!file.ok) throw new RegistryError(`GitHub answered ${file.status} for ${asset.name}`, 502);
  return {
    release: ref,
    url: release.html_url,
    asset: asset.name,
    published: release.published_at,
    bom: JSON.parse(Buffer.from(await file.arrayBuffer()).toString('utf8')),
  };
}
