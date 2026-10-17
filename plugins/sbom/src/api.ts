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
