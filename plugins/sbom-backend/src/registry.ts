/**
 * Just enough of the OCI distribution API to find the SBOM attached to an image: the digest of a tag, the artifacts
 * that refer to that digest (the referrers API, or the tag `sha256-<hex>` that `oras attach` writes on a registry
 * without it) and a blob. Read only; one bearer token per repository, from the registry's token endpoint.
 */

export const SBOM_ARTIFACT_TYPE = 'application/vnd.cyclonedx+json';

const MANIFEST_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

export class RegistryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface ImageRef {
  host: string;
  repository: string;
  /** a tag or a digest (sha256:...) */
  reference: string;
}

/** ghcr.io/owner/name:tag, ghcr.io/owner/name@sha256:... (a registry host is required). */
export function parseImageRef(ref: string): ImageRef {
  const at = ref.indexOf('@');
  let name = ref;
  let reference = 'latest';
  if (at >= 0) {
    name = ref.slice(0, at);
    reference = ref.slice(at + 1);
  } else {
    const colon = ref.lastIndexOf(':');
    if (colon > ref.lastIndexOf('/')) {
      name = ref.slice(0, colon);
      reference = ref.slice(colon + 1);
    }
  }
  const slash = name.indexOf('/');
  const host = slash > 0 ? name.slice(0, slash) : '';
  if (!host || (!/[.:]/.test(host) && host !== 'localhost')) {
    throw new RegistryError(`Not an image with its registry: ${ref}`, 400);
  }
  const repository = name.slice(slash + 1);
  if (!/^[a-z0-9]+([._/-][a-z0-9]+)*$/.test(repository) || !/^([\w][\w.-]{0,127}|sha256:[a-f0-9]{64})$/.test(reference)) {
    throw new RegistryError(`Not a valid image reference: ${ref}`, 400);
  }
  return { host, repository, reference };
}

export interface Descriptor {
  mediaType: string;
  digest: string;
  size: number;
  artifactType?: string;
  annotations?: Record<string, string>;
}

export interface Credentials {
  username: string;
  password: string;
}

/** The credentials of a host in a Docker config JSON ({"auths": {"ghcr.io": {"auth": base64(user:password)}}}). */
export function credentialsFromDockerConfig(json: string | undefined, host: string): Credentials | undefined {
  if (!json) return undefined;
  const auths = (JSON.parse(json).auths ?? {}) as Record<string, { auth?: string; username?: string; password?: string }>;
  const entry = auths[host] ?? auths[`https://${host}`];
  if (!entry) return undefined;
  if (entry.username && entry.password) return { username: entry.username, password: entry.password };
  if (!entry.auth) return undefined;
  const plain = Buffer.from(entry.auth, 'base64').toString('utf8');
  const colon = plain.indexOf(':');
  return colon < 0 ? undefined : { username: plain.slice(0, colon), password: plain.slice(colon + 1) };
}

type Fetch = typeof fetch;

export class RegistryClient {
  private readonly tokens = new Map<string, string>();

  constructor(
    private readonly credentials: (host: string) => Credentials | undefined,
    private readonly fetchImpl: Fetch = fetch,
    private readonly scheme: (host: string) => string = host => (host.startsWith('localhost') ? 'http' : 'https'),
  ) {}

  /** A GET of the registry API, with the bearer token of the repository (asked for on the first 401). */
  private async get(image: ImageRef, path: string, accept?: string): Promise<Response> {
    const url = `${this.scheme(image.host)}://${image.host}/v2/${image.repository}${path}`;
    const key = `${image.host}/${image.repository}`;
    const call = (token?: string) =>
      this.fetchImpl(url, {
        headers: { ...(accept ? { Accept: accept } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        redirect: 'follow',
      });
    let res = await call(this.tokens.get(key));
    if (res.status === 401) {
      const token = await this.token(image, res.headers.get('www-authenticate') ?? '');
      this.tokens.set(key, token);
      res = await call(token);
    }
    return res;
  }

  private async token(image: ImageRef, challenge: string): Promise<string> {
    const params = Object.fromEntries([...challenge.matchAll(/(\w+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    if (!/^bearer/i.test(challenge) || !params.realm) {
      throw new RegistryError(`${image.host} asks for an authentication that is not a bearer token`, 502);
    }
    const url = new URL(params.realm);
    if (params.service) url.searchParams.set('service', params.service);
    url.searchParams.set('scope', `repository:${image.repository}:pull`);
    const creds = this.credentials(image.host);
    const res = await this.fetchImpl(url.toString(), {
      headers: creds ? { Authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}` } : {},
    });
    if (!res.ok) {
      throw new RegistryError(`${image.host} refused a token to read ${image.repository} (${res.status})`, res.status === 401 || res.status === 403 ? 502 : res.status);
    }
    const body = (await res.json()) as { token?: string; access_token?: string };
    const token = body.token ?? body.access_token;
    if (!token) throw new RegistryError(`${image.host} gave no token`, 502);
    return token;
  }

  private async must(image: ImageRef, path: string, what: string, accept?: string): Promise<Response> {
    const res = await this.get(image, path, accept);
    if (res.status === 404) throw new RegistryError(`${what} is not in ${image.host}/${image.repository}`, 404);
    if (!res.ok) throw new RegistryError(`${image.host} answered ${res.status} for ${what}`, 502);
    return res;
  }

  /** The digest the reference points at (the image index when the image is multi-platform). */
  async resolve(image: ImageRef): Promise<string> {
    if (image.reference.startsWith('sha256:')) return image.reference;
    const res = await this.must(image, `/manifests/${image.reference}`, `The tag ${image.reference}`, MANIFEST_TYPES);
    const digest = res.headers.get('docker-content-digest');
    if (digest) return digest;
    const { createHash } = await import('crypto');
    return `sha256:${createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex')}`;
  }

  /** The artifacts of that type that refer to the digest: the referrers API, or the fallback tag of oras. */
  async referrers(image: ImageRef, digest: string, artifactType: string): Promise<Descriptor[]> {
    const pick = (index: { manifests?: Descriptor[] }) => (index.manifests ?? []).filter(m => m.artifactType === artifactType);
    const api = await this.get(image, `/referrers/${digest}?artifactType=${encodeURIComponent(artifactType)}`, 'application/vnd.oci.image.index.v1+json');
    if (api.ok) {
      const found = pick((await api.json()) as { manifests?: Descriptor[] });
      if (found.length) return found;
    }
    // registries without the referrers API: the index that oras keeps in the tag sha256-<hex>
    const tag = await this.get(image, `/manifests/${digest.replace(':', '-')}`, 'application/vnd.oci.image.index.v1+json');
    if (tag.status === 404) return [];
    if (!tag.ok) throw new RegistryError(`${image.host} answered ${tag.status} for the referrers of ${digest}`, 502);
    return pick((await tag.json()) as { manifests?: Descriptor[] });
  }

  async manifest(image: ImageRef, digest: string): Promise<{ layers?: Descriptor[]; annotations?: Record<string, string> }> {
    const res = await this.must(image, `/manifests/${digest}`, `The manifest ${digest}`, 'application/vnd.oci.image.manifest.v1+json');
    return (await res.json()) as { layers?: Descriptor[]; annotations?: Record<string, string> };
  }

  async blob(image: ImageRef, digest: string, maxBytes: number): Promise<Buffer> {
    const res = await this.must(image, `/blobs/${digest}`, `The blob ${digest}`);
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > maxBytes) throw new RegistryError(`The SBOM is larger than ${maxBytes} bytes`, 413);
    return data;
  }
}

export interface FoundSbom {
  image: string;
  digest: string;
  sbomDigest: string;
  created?: string;
  revision?: string;
  bom: unknown;
}

/** The newest CycloneDX SBOM attached to the image (by `created` of oras attach), or undefined when it has none. */
export async function findSbom(client: RegistryClient, ref: string, maxBytes = 20 * 1024 * 1024): Promise<FoundSbom | undefined> {
  const image = parseImageRef(ref);
  const digest = await client.resolve(image);
  const found = await client.referrers(image, digest, SBOM_ARTIFACT_TYPE);
  if (!found.length) return undefined;
  const created = (d: Descriptor) => d.annotations?.['org.opencontainers.image.created'] ?? '';
  const newest = [...found].sort((a, b) => created(b).localeCompare(created(a)))[0];
  const manifest = await client.manifest(image, newest.digest);
  const layer = (manifest.layers ?? []).find(l => l.mediaType === SBOM_ARTIFACT_TYPE) ?? manifest.layers?.[0];
  if (!layer) throw new RegistryError(`The SBOM ${newest.digest} has no content`, 502);
  const bom = JSON.parse((await client.blob(image, layer.digest, maxBytes)).toString('utf8'));
  return {
    image: ref,
    digest,
    sbomDigest: newest.digest,
    created: created(newest) || manifest.annotations?.['org.opencontainers.image.created'],
    revision: newest.annotations?.['org.opencontainers.image.revision'] ?? manifest.annotations?.['org.opencontainers.image.revision'],
    bom,
  };
}
