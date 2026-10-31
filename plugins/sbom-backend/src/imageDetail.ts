import { SbomSummary, summarize } from './cyclonedx';
import { RegistryClient, RegistryError, parseImageRef } from './registry';

/**
 * The detail of one image of the image catalog (tab Image of a container-image entity): for one tag, every
 * finding of Harbor's scan marked when the project's CVE allowlist covers it (the allowlist the Harbor sync builds
 * from the VEX of the image: "not affected" by its maker), the SBOM and SLSA provenance the maker attached (OCI
 * referrers, in-toto statements), whether a signature is attached, and the history of the repository.
 * Read anonymously from the Harbor of the zone only, like the catalog (imageCatalog.ts).
 */

const IN_TOTO = 'application/vnd.in-toto+json';
const COSIGN_SIG = 'application/vnd.dev.cosign.artifact.sig.v1+json';

export interface Finding {
  id: string;
  package: string;
  version: string;
  fixVersion: string;
  severity: string;
  score?: number;
  description: string;
  link?: string;
  /** in the CVE allowlist of the project: declared not affected (or fixed) in the VEX of the image */
  coveredByVex: boolean;
  platforms: string[];
}

export interface Provenance {
  predicateType: string;
  builder?: string;
  buildType?: string;
  source?: string;
  revision?: string;
  startedOn?: string;
  finishedOn?: string;
}

export interface HistoryEntry {
  digest: string;
  tags: string[];
  pushedAt: string;
  critical: number;
  high: number;
  scanned: boolean;
}

export interface ImageDetail {
  repository: string;
  tag: string;
  digest: string;
  platforms: { platform: string; digest: string }[];
  scan: { status: string; scanner?: string; generatedAt?: string } | null;
  findings: Finding[];
  allowlist: { count: number; expiresAt?: string };
  signatureAttached: boolean;
  attestations: { predicateType: string; digest: string }[];
  sbom: (SbomSummary & { predicateType: string }) | null;
  provenance: Provenance | null;
  history: HistoryEntry[];
  errors: string[];
}

type HarborArtifact = {
  digest: string;
  push_time?: string;
  tags?: { name: string }[] | null;
  references?: { child_digest: string; platform?: { os?: string; architecture?: string } }[] | null;
  scan_overview?: Record<string, { scan_status?: string; summary?: { summary?: Record<string, number> } }> | null;
};

type HarborVuln = {
  id: string;
  package: string;
  version: string;
  fix_version?: string;
  severity: string;
  description?: string;
  links?: string[];
  artifact_digests?: string[];
  preferred_cvss?: { score_v3?: number | null };
};

const RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3, Unknown: 4, None: 5 };

/** in-toto statement (plain or in a DSSE envelope) */
export function statementOf(raw: Buffer | string): { predicateType?: string; predicate?: any } {
  const doc = JSON.parse(raw.toString());
  if (doc && typeof doc.payload === 'string') return JSON.parse(Buffer.from(doc.payload, 'base64').toString());
  return doc;
}

/** The fields of a SLSA provenance (v1, or v0.2) worth showing. */
export function provenanceOf(predicateType: string, p: any): Provenance {
  if (p?.buildDefinition || p?.runDetails) {
    const vcs = p.runDetails?.metadata?.buildkit_metadata?.vcs ?? {};
    return {
      predicateType,
      builder: p.runDetails?.builder?.id,
      buildType: p.buildDefinition?.buildType,
      source: vcs.source,
      revision: vcs.revision,
      startedOn: p.runDetails?.metadata?.startedOn,
      finishedOn: p.runDetails?.metadata?.finishedOn,
    };
  }
  const vcs = p?.metadata?.['https://mobyproject.org/buildkit@v1#metadata']?.vcs ?? {};
  return {
    predicateType,
    builder: p?.builder?.id,
    buildType: p?.buildType,
    source: vcs.source,
    revision: vcs.revision,
    startedOn: p?.metadata?.buildStartedOn,
    finishedOn: p?.metadata?.buildFinishedOn,
  };
}

export function findingsOf(report: unknown, allowlist: Set<string>, platformOf: Map<string, string>): Finding[] {
  const first = Object.values((report ?? {}) as Record<string, { vulnerabilities?: HarborVuln[] }>)[0];
  const out = new Map<string, Finding>();
  for (const v of first?.vulnerabilities ?? []) {
    const key = `${v.id} ${v.package} ${v.version}`;
    const platforms = (v.artifact_digests ?? []).map(d => platformOf.get(d) ?? d.slice(0, 19));
    const seen = out.get(key);
    if (seen) {
      seen.platforms = [...new Set([...seen.platforms, ...platforms])].sort();
      continue;
    }
    out.set(key, {
      id: v.id,
      package: v.package,
      version: v.version,
      fixVersion: v.fix_version ?? '',
      severity: v.severity,
      score: v.preferred_cvss?.score_v3 ?? undefined,
      description: (v.description ?? '').slice(0, 400),
      link: v.links?.[0],
      coveredByVex: allowlist.has(v.id),
      platforms: [...new Set(platforms)].sort(),
    });
  }
  return [...out.values()].sort(
    (a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) || (b.score ?? 0) - (a.score ?? 0) || a.id.localeCompare(b.id),
  );
}

export class ImageDetailService {
  private readonly cache = new Map<string, { at: number; detail: ImageDetail }>();
  private readonly host: string;
  private readonly base: string;

  constructor(
    harborUrl: string,
    private readonly projects: string[],
    private readonly registry: RegistryClient,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly ttlMs = 10 * 60 * 1000,
  ) {
    this.base = harborUrl.replace(/\/+$/, '');
    this.host = new URL(harborUrl).host;
  }

  private async api<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.base}/api/v2.0${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 404) throw new RegistryError(`Harbor has no ${path}`, 404);
    if (!res.ok) throw new RegistryError(`Harbor answered ${res.status} for ${path}`, 502);
    return (await res.json()) as T;
  }

  async detail(repository: string, tag: string): Promise<ImageDetail> {
    const slash = repository.indexOf('/');
    const project = repository.slice(0, slash);
    const name = repository.slice(slash + 1);
    if (slash <= 0 || !this.projects.includes(project) || !/^[a-z0-9]+([._/-][a-z0-9]+)*$/.test(name)) {
      throw new RegistryError(`Not an image of the catalog: ${repository}`, 400);
    }
    if (!/^[\w][\w.-]{0,127}$/.test(tag)) throw new RegistryError(`Not a valid tag: ${tag}`, 400);
    const key = `${repository}:${tag}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.detail;
    const detail = await this.build(project, name, tag);
    this.cache.set(key, { at: Date.now(), detail });
    if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value as string);
    return detail;
  }

  private async build(project: string, name: string, tag: string): Promise<ImageDetail> {
    const errors: string[] = [];
    const repo = encodeURIComponent(encodeURIComponent(name));
    const arts = `/projects/${encodeURIComponent(project)}/repositories/${repo}/artifacts`;
    const all = await this.api<HarborArtifact[]>(`${arts}?with_tag=true&with_scan_overview=true&page_size=100`);
    const art = all.find(a => (a.tags ?? []).some(t => t.name === tag));
    if (!art) throw new RegistryError(`${project}/${name}:${tag} is not in Harbor`, 404);

    const platforms = (art.references ?? []).map(r => ({
      platform: `${r.platform?.os ?? '?'}/${r.platform?.architecture ?? '?'}`,
      digest: r.child_digest,
    }));
    if (platforms.length === 0) platforms.push({ platform: 'linux/amd64', digest: art.digest });
    const platformOf = new Map(platforms.map(p => [p.digest, p.platform]));

    // the project's CVE allowlist (rebuilt from the VEX by every sync, 7 days)
    let allowlist = new Set<string>();
    let expiresAt: string | undefined;
    try {
      const found = await this.api<{ name: string; cve_allowlist?: { items?: { cve_id: string }[]; expires_at?: number | null } }[]>(
        `/projects?name=${encodeURIComponent(project)}`,
      );
      const p = (found ?? []).find(x => x.name === project);
      allowlist = new Set((p?.cve_allowlist?.items ?? []).map(i => i.cve_id));
      if (p?.cve_allowlist?.expires_at) expiresAt = new Date(p.cve_allowlist.expires_at * 1000).toISOString();
    } catch (e) {
      errors.push(`allowlist: ${(e as Error).message}`);
    }

    // Harbor's scan of the tag (an index: every platform, each finding says where)
    let findings: Finding[] = [];
    let scan: ImageDetail['scan'] = null;
    try {
      const report = await this.api<Record<string, { generated_at?: string; scanner?: { name?: string; version?: string } }>>(
        `${arts}/${encodeURIComponent(art.digest)}/additions/vulnerabilities`,
      );
      const r = Object.values(report ?? {})[0];
      const status = Object.values(art.scan_overview ?? {})[0]?.scan_status ?? (r ? 'Success' : 'none');
      scan = { status, scanner: r?.scanner ? `${r.scanner.name ?? ''} ${r.scanner.version ?? ''}`.trim() : undefined, generatedAt: r?.generated_at };
      findings = findingsOf(report, allowlist, platformOf);
    } catch (e) {
      errors.push(`scan: ${(e as Error).message}`);
    }

    // what the maker attached: signature on the index, SBOM and provenance on the image of linux/amd64
    const ref = parseImageRef(`${this.host}/${project}/${name}:${tag}`);
    let signatureAttached = false;
    try {
      signatureAttached = (await this.registry.referrers(ref, art.digest, COSIGN_SIG)).length > 0;
    } catch (e) {
      errors.push(`signature: ${(e as Error).message}`);
    }
    const main = platforms.find(p => p.platform === 'linux/amd64') ?? platforms[0];
    let attestations: ImageDetail['attestations'] = [];
    let sbom: ImageDetail['sbom'] = null;
    let provenance: Provenance | null = null;
    try {
      const refs = await this.registry.referrers(ref, main.digest, IN_TOTO);
      attestations = refs
        .map(d => ({ predicateType: d.annotations?.['in-toto.io/predicate-type'] ?? '', digest: d.digest }))
        .sort((a, b) => a.predicateType.localeCompare(b.predicateType));
      const read = async (digest: string) => {
        const m = await this.registry.manifest(ref, digest);
        const layer = m.layers?.[0];
        if (!layer) throw new RegistryError(`attestation ${digest} has no layer`, 502);
        return statementOf(await this.registry.blob(ref, layer.digest, 20 * 1024 * 1024));
      };
      const bom = attestations.find(a => a.predicateType.includes('cyclonedx'));
      if (bom) sbom = { ...summarize((await read(bom.digest)).predicate), predicateType: bom.predicateType };
      const prov =
        attestations.find(a => a.predicateType.startsWith('https://slsa.dev/provenance/v1')) ??
        attestations.find(a => a.predicateType.startsWith('https://slsa.dev/provenance'));
      if (prov) provenance = provenanceOf(prov.predicateType, (await read(prov.digest)).predicate);
    } catch (e) {
      errors.push(`attestations: ${(e as Error).message}`);
    }

    const history = all
      .map(a => {
        const s = Object.values(a.scan_overview ?? {})[0];
        return {
          digest: a.digest,
          tags: (a.tags ?? []).map(t => t.name),
          pushedAt: a.push_time ?? '',
          critical: s?.summary?.summary?.Critical ?? 0,
          high: s?.summary?.summary?.High ?? 0,
          scanned: s?.scan_status === 'Success',
        };
      })
      .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));

    return {
      repository: `${project}/${name}`,
      tag,
      digest: art.digest,
      platforms,
      scan,
      findings,
      allowlist: { count: allowlist.size, expiresAt },
      signatureAttached,
      attestations,
      sbom,
      provenance,
      history,
      errors,
    };
  }
}
