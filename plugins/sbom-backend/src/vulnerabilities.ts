/**
 * The vulnerabilities of an image as Wazuh's daily image scan (Trivy) found them: the security exporter of
 * wazuh-oneke serves the last scan of each running image digest (GET /vulnerabilities?digest=...). Read only.
 */

export interface Vulnerability {
  id: string;
  sev: string;
  pkg?: string;
  ver?: string;
  fix?: string;
  title?: string;
}

export interface ImageScan {
  digest: string;
  image?: string;
  namespace?: string;
  /** when the scan ran, and the date of its vulnerability database */
  run?: string;
  db?: string;
  status: 'scanned' | 'scan_error';
  message?: string | null;
  counts: Record<string, number>;
  os?: string | null;
  /** CRITICAL and HIGH only */
  vulns: Vulnerability[];
}

/**
 * The last scan of the image digest, else of the image reference the pods run; undefined when the last run did not
 * see it (an image deployed after the scan, or not running).
 */
export async function findImageScan(
  baseUrl: string,
  digest: string,
  image: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ImageScan | undefined> {
  const base = baseUrl.replace(/\/+$/, '');
  for (const query of [`digest=${encodeURIComponent(digest)}`, `image=${encodeURIComponent(image)}`]) {
    const res = await fetchImpl(`${base}/vulnerabilities?${query}`, { headers: { Accept: 'application/json' } });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`The image scan answered ${res.status}`);
    return (await res.json()) as ImageScan;
  }
  return undefined;
}
