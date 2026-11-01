import { RegistryClient, RegistryError, parseImageRef } from './registry';

/**
 * The image catalog of Refresquito: the images of Harbor that a system may use (projects common, framework-python,
 * framework-spring), for the page Images and the catalog entities of kind Resource / type container-image.
 *
 * Two sources, both in the Harbor of the zone (nothing else, so it works air-gapped):
 *   1. the catalog that the host publishes with every sync (opennebula harbor/image_catalog.py): the OCI artifact
 *      <harbor>/common/image-catalog:current, schema refresquito.image-catalog/v1: category, audience, summary,
 *      state, replaced_by, owner of each tag, and what the sync copied (signatures, attestations per platform);
 *   2. Harbor's API, anonymous for public projects: per tag its digest, push time, scan summary and the annotations
 *      of the image (DHI: version, license, end of life, distro, CIS).
 * Without (1) (not published yet, or unreadable) the page still lists what Harbor has, without the fields of (1).
 */

export const IMAGE_CATALOG_SCHEMA = 'refresquito.image-catalog/v1';
export const DEFAULT_PROJECTS = ['common', 'framework-python', 'framework-spring'];
const CATALOG_REPOSITORY = 'image-catalog';

/** One tag as the host publishes it (image_catalog.py build). */
export interface CatalogTag {
  tag: string;
  category: string;
  summary: string;
  audience: 'apps' | 'platform';
  state: 'approved' | 'deprecated' | 'retired';
  replacedBy: string;
  owner: string;
  eol: string;
  license: string;
  note: string;
  synced: boolean;
  digest?: string;
  sourceSignatureVerified?: boolean;
  signatures?: string[];
  platforms?: { platform: string; digest: string; attestations: string[] }[];
  /** signed in Harbor with the key of Refresquito: it passed the gate of the quarantine (opennebula #65) */
  refresquitoSigned?: boolean;
  /** a newer version of the tag held in the quarantine (the digest held, why); the project keeps `digest` */
  quarantine?: { digest: string; reasons: string[] };
}

/** Facts of the supply chain of this Harbor (catalog field supplyChain, opennebula #68). */
export interface SupplyChain {
  airgapped: boolean;
  vulnerabilityDb?: { updatedAt?: string; nextUpdate?: string; javaUpdatedAt?: string; source?: 'online' | 'bundle' };
  lastBundle?: { direction: 'import' | 'export'; id: string; createdAt?: string; importedAt?: string; exportedAt?: string } | null;
}

export interface CatalogDocument {
  schema: string;
  generatedAt: string;
  catalogCommit: string;
  categories: Record<string, string>;
  images: { project: string; name: string; repository: string; source: string; tags: CatalogTag[] }[];
  supplyChain?: SupplyChain;
}

export interface ScanSummary {
  status: string;
  severity: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  fixable?: number;
  scannedAt?: string;
}

/** What the page shows of one tag: the catalog fields (when published) + Harbor's live data. */
export interface ImageTagView {
  tag: string;
  pull: string;
  category: string;
  summary: string;
  audience: 'apps' | 'platform' | 'unknown';
  state: 'approved' | 'deprecated' | 'retired' | 'unknown';
  replacedBy: string;
  owner: string;
  note: string;
  inHarbor: boolean;
  digest: string;
  pushedAt: string;
  version: string;
  title: string;
  license: string;
  eol: string;
  distro: string;
  compliance: string;
  scan?: ScanSummary;
  sourceSignatureVerified: boolean;
  attestations: string[];
  refresquitoSigned: boolean;
  quarantine?: { digest: string; reasons: string[] };
}

export interface ImageView {
  repository: string;
  project: string;
  name: string;
  source: string;
  harborUrl: string;
  tags: ImageTagView[];
}

export interface ImageCatalogView {
  configured: boolean;
  harbor?: string;
  catalog?: { published: boolean; generatedAt?: string; commit?: string; error?: string };
  categories: Record<string, string>;
  images: ImageView[];
  supplyChain?: SupplyChain;
  errors: string[];
}

export interface ImageCatalogSettings {
  /** https://harbor.<domain>: Harbor's API and UI */
  harborUrl: string;
  /** the projects shown (default: DEFAULT_PROJECTS) */
  projects: string[];
}

type HarborArtifact = {
  digest: string;
  push_time?: string;
  tags?: { name: string }[] | null;
  annotations?: Record<string, string> | null;
  scan_overview?: Record<string, { scan_status?: string; severity?: string; end_time?: string; summary?: { summary?: Record<string, number>; fixable?: number } }> | null;
};

const encodeRepo = (name: string) => encodeURIComponent(encodeURIComponent(name));

export function scanOf(a: HarborArtifact): ScanSummary | undefined {
  const report = Object.values(a.scan_overview ?? {})[0];
  if (!report) return undefined;
  const s = report.summary?.summary ?? {};
  return {
    status: report.scan_status ?? '',
    severity: report.severity ?? '',
    critical: s.Critical ?? 0,
    high: s.High ?? 0,
    medium: s.Medium ?? 0,
    low: s.Low ?? 0,
    fixable: report.summary?.fixable,
    scannedAt: report.end_time,
  };
}

/** The annotations Harbor gives of an image: OCI ones, and the DHI ones that OCI has no key for. */
export function annotationsOf(a: HarborArtifact) {
  const an = a.annotations ?? {};
  return {
    version: an['org.opencontainers.image.version'] ?? an['com.docker.dhi.version'] ?? '',
    title: an['com.docker.dhi.title'] ?? an['org.opencontainers.image.title'] ?? '',
    license: an['org.opencontainers.image.licenses'] ?? '',
    eol: an['com.docker.dhi.date.end-of-life'] ?? '',
    distro: an['com.docker.dhi.distro'] ?? '',
    compliance: an['com.docker.dhi.compliance'] ?? '',
  };
}

export function parseCatalog(raw: Buffer | string): CatalogDocument {
  const doc = JSON.parse(raw.toString()) as CatalogDocument;
  if (doc?.schema !== IMAGE_CATALOG_SCHEMA || !Array.isArray(doc.images)) {
    throw new RegistryError(`The image catalog is not ${IMAGE_CATALOG_SCHEMA}`, 502);
  }
  return doc;
}

export class ImageCatalogService {
  private cache?: { at: number; view: ImageCatalogView };
  private readonly host: string;

  constructor(
    private readonly settings: ImageCatalogSettings,
    private readonly registry: RegistryClient,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly ttlMs = 10 * 60 * 1000,
  ) {
    this.host = new URL(settings.harborUrl).host;
  }

  private async api<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.settings.harborUrl.replace(/\/+$/, '')}/api/v2.0${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new RegistryError(`Harbor answered ${res.status} for ${path}`, 502);
    return (await res.json()) as T;
  }

  /** The published catalog, or undefined when it is not there yet (404). */
  async readCatalog(): Promise<CatalogDocument | undefined> {
    const ref = parseImageRef(`${this.host}/common/${CATALOG_REPOSITORY}:current`);
    try {
      const digest = await this.registry.resolve(ref);
      const manifest = await this.registry.manifest(ref, digest);
      const layer = manifest.layers?.[0];
      if (!layer) throw new RegistryError('The image catalog artifact has no layer', 502);
      return parseCatalog(await this.registry.blob(ref, layer.digest, 5 * 1024 * 1024));
    } catch (e) {
      if (e instanceof RegistryError && e.status === 404) return undefined;
      throw e;
    }
  }

  private async artifacts(project: string, name: string): Promise<HarborArtifact[]> {
    return this.api<HarborArtifact[]>(
      `/projects/${encodeURIComponent(project)}/repositories/${encodeRepo(name)}/artifacts?with_tag=true&with_scan_overview=true&page_size=100`,
    );
  }

  async view(): Promise<ImageCatalogView> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.view;
    const view = await this.build();
    this.cache = { at: Date.now(), view };
    return view;
  }

  private async build(): Promise<ImageCatalogView> {
    const errors: string[] = [];
    const base = this.settings.harborUrl.replace(/\/+$/, '');
    let catalog: CatalogDocument | undefined;
    let catalogError: string | undefined;
    try {
      catalog = await this.readCatalog();
    } catch (e) {
      catalogError = (e as Error).message;
      errors.push(`image catalog: ${catalogError}`);
    }

    // project ids (for the links to Harbor's UI)
    const projectIds = new Map<string, number>();
    for (const p of this.settings.projects) {
      try {
        const found = await this.api<{ name: string; project_id: number }[]>(`/projects?name=${encodeURIComponent(p)}`);
        const hit = (found ?? []).find(x => x.name === p);
        if (hit) projectIds.set(p, hit.project_id);
      } catch (e) {
        errors.push(`project ${p}: ${(e as Error).message}`);
      }
    }

    // the repositories: those of the catalog, or (without it) every repository of the projects
    type Repo = { project: string; name: string; source: string; tags?: CatalogTag[] };
    let repos: Repo[];
    if (catalog) {
      repos = catalog.images.filter(i => this.settings.projects.includes(i.project));
    } else {
      repos = [];
      for (const p of projectIds.keys()) {
        try {
          const list = await this.api<{ name: string }[]>(`/projects/${encodeURIComponent(p)}/repositories?page_size=100`);
          for (const r of list ?? []) {
            const name = r.name.slice(p.length + 1);
            if (p === 'common' && name === CATALOG_REPOSITORY) continue;
            repos.push({ project: p, name, source: '' });
          }
        } catch (e) {
          errors.push(`repositories of ${p}: ${(e as Error).message}`);
        }
      }
    }

    const images: ImageView[] = [];
    for (const r of repos) {
      let arts: HarborArtifact[] = [];
      try {
        arts = await this.artifacts(r.project, r.name);
      } catch (e) {
        errors.push(`${r.project}/${r.name}: ${(e as Error).message}`);
      }
      const byTag = new Map<string, HarborArtifact>();
      for (const a of arts) for (const t of a.tags ?? []) byTag.set(t.name, a);
      const tagNames = r.tags ? r.tags.map(t => t.tag) : [...byTag.keys()].sort();
      const pid = projectIds.get(r.project);
      images.push({
        repository: `${r.project}/${r.name}`,
        project: r.project,
        name: r.name,
        source: r.source,
        harborUrl: pid ? `${base}/harbor/projects/${pid}/repositories/${encodeURIComponent(r.name)}/artifacts-tab` : base,
        tags: tagNames.map(tag => {
          const c = r.tags?.find(t => t.tag === tag);
          const a = byTag.get(tag);
          const an = a ? annotationsOf(a) : { version: '', title: '', license: '', eol: '', distro: '', compliance: '' };
          const attestations = [...new Set((c?.platforms ?? []).flatMap(p => p.attestations))].sort();
          return {
            tag,
            pull: `${this.host}/${r.project}/${r.name}:${tag}`,
            category: c?.category ?? 'uncategorised',
            summary: c?.summary ?? '',
            audience: c?.audience ?? 'unknown',
            state: c?.state ?? 'unknown',
            replacedBy: c?.replacedBy ?? '',
            owner: c?.owner ?? '',
            note: c?.note ?? '',
            inHarbor: !!a,
            digest: a?.digest ?? c?.digest ?? '',
            pushedAt: a?.push_time ?? '',
            version: an.version,
            title: an.title,
            license: c?.license || an.license,
            eol: c?.eol || an.eol,
            distro: an.distro,
            compliance: an.compliance,
            scan: a ? scanOf(a) : undefined,
            sourceSignatureVerified: !!c?.sourceSignatureVerified,
            attestations,
            refresquitoSigned: !!c?.refresquitoSigned,
            ...(c?.quarantine ? { quarantine: { digest: c.quarantine.digest, reasons: (c.quarantine.reasons ?? []).slice(0, 20) } } : {}),
          };
        }),
      });
    }
    images.sort((x, y) => x.repository.localeCompare(y.repository));
    return {
      configured: true,
      harbor: base,
      catalog: catalog
        ? { published: true, generatedAt: catalog.generatedAt, commit: catalog.catalogCommit }
        : { published: false, error: catalogError },
      categories: catalog?.categories ?? {},
      images,
      ...(catalog?.supplyChain ? { supplyChain: catalog.supplyChain } : {}),
      errors,
    };
  }
}
