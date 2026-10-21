import { useCallback, useEffect, useState } from 'react';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';

export interface Component {
  name: string;
  group?: string;
  version?: string;
  ecosystem: string;
  purl?: string;
  licenses: string[];
}

export interface SbomSummary {
  specVersion?: string;
  generatedAt?: string;
  generator?: string;
  subject?: string;
  total: number;
  ecosystems: Record<string, number>;
  licenses: Record<string, number>;
  frameworks: Component[];
  components: Component[];
}

export interface ImageSbom {
  /** the image, or for a release owner/repo@tag */
  image: string;
  kind: 'image' | 'release';
  /** a release: its page on GitHub and the name of its SBOM file */
  url?: string;
  asset?: string;
  digest?: string;
  sbomDigest?: string;
  created?: string;
  revision?: string;
  /** null: the image has no SBOM attached (built before the CI made them) */
  summary: SbomSummary | null;
}

async function errorText(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body.error ?? `${res.status} ${res.statusText}`;
}

export function useSbom(kind: 'image' | 'release', ref: string) {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; error?: string; data?: ImageSbom }>({ loading: true });
  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    (async () => {
      const base = await discovery.getBaseUrl('sbom');
      const res = await fetch(`${base}/${kind}?ref=${encodeURIComponent(ref)}`);
      if (!res.ok) throw new Error(await errorText(res));
      const body = await res.json();
      return { ...body, kind, image: body.image ?? body.release } as ImageSbom;
    })().then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, kind, ref]);
  return state;
}

export interface Vulnerability {
  id: string;
  sev: string;
  pkg?: string;
  ver?: string;
  fix?: string;
  title?: string;
}

/** The last scan of an image by Wazuh's daily image scan (Trivy), through the security exporter of wazuh-oneke. */
export interface ImageScan {
  digest: string;
  namespace?: string;
  run?: string;
  db?: string;
  status: 'scanned' | 'scan_error';
  message?: string | null;
  counts: Record<string, number>;
  os?: string | null;
  /** CRITICAL and HIGH only */
  vulns: Vulnerability[];
}

export interface ImageVulnerabilities {
  image: string;
  /** false: this Backstage has no sbom.vulnerabilitiesUrl */
  configured: boolean;
  digest?: string;
  /** null: the last scan did not see this image (deployed after it, or not running) */
  scan: ImageScan | null;
}

export function useVulnerabilities(ref: string) {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; error?: string; data?: ImageVulnerabilities }>({ loading: true });
  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    (async () => {
      const base = await discovery.getBaseUrl('sbom');
      const res = await fetch(`${base}/vulnerabilities?ref=${encodeURIComponent(ref)}`);
      if (!res.ok) throw new Error(await errorText(res));
      return (await res.json()) as ImageVulnerabilities;
    })().then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, ref]);
  return state;
}

/** Downloads the CycloneDX document of the image (the request carries the Backstage token, so not a plain link). */
export function useDownload() {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  return useCallback(
    async (kind: 'image' | 'release', image: string) => {
      const base = await discovery.getBaseUrl('sbom');
      const res = await fetch(`${base}/${kind}/raw?ref=${encodeURIComponent(image)}`);
      if (!res.ok) throw new Error(await errorText(res));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${image.split('/').pop()!.replace(/[:@]/g, '-')}.cdx.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [discovery, fetch],
  );
}

/** The quality report of an application (quality.json its CI attaches to its images; the same on each of them). */
export interface TestCase {
  name: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  time: number;
  message?: string;
}

export interface FileCoverage {
  file: string;
  lines: number;
  branches?: number;
  statements?: number;
  missing?: string;
}

export interface QualityPart {
  tests?: { total: number; failures: number; errors: number; skipped: number };
  coverage?: { lines?: number; branches?: number; statements?: number; functions?: number };
  ruff?: { issues: number };
  mypy?: { errors: number };
  eslint?: { errors: number; warnings: number };
  detail?: { tests?: TestCase[]; coverage?: FileCoverage[] };
}

export interface QualityReport {
  schema: string;
  revision?: string;
  generated?: string;
  backend?: QualityPart;
  frontend?: QualityPart;
}

export interface ImageQuality {
  image: string;
  attached: { digest: string; created?: string; revision?: string } | null;
  /** null: the image has no quality report attached (built before its CI made them) */
  report: QualityReport | null;
}

export function useQuality(ref: string | undefined) {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; error?: string; data?: ImageQuality }>({ loading: !!ref });
  useEffect(() => {
    if (!ref) return undefined;
    let alive = true;
    setState({ loading: true });
    (async () => {
      const base = await discovery.getBaseUrl('sbom');
      const res = await fetch(`${base}/quality?ref=${encodeURIComponent(ref)}`);
      if (!res.ok) throw new Error(await errorText(res));
      return (await res.json()) as ImageQuality;
    })().then(
      data => alive && setState({ loading: false, data }),
      e => alive && setState({ loading: false, error: (e as Error).message }),
    );
    return () => {
      alive = false;
    };
  }, [discovery, fetch, ref]);
  return state;
}
