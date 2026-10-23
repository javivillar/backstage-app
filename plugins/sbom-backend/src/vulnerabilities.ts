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
  /**
   * The context Wazuh adds (wazuh-oneke 0.20.0, USE-CASES.md I6): FIRST EPSS score and percentile, whether it is in
   * CISA KEV (absent when the KEV feed is not available: unknown), and since when its image repository has it.
   */
  epss?: number;
  epss_pct?: number;
  kev?: boolean;
  kev_added?: string;
  kev_due?: string;
  kev_ransomware?: boolean;
  first_seen?: string;
  age_days?: number;
}

/** Per image, computed by Wazuh. kev null: the KEV feed was not available. *_max_days -1: none open. */
export interface ScanContext {
  kev: number | null;
  kev_ids?: string[];
  kev_ransomware?: number | null;
  epss_max?: number | null;
  epss_max_id?: string | null;
  critical_fix_max_days?: number;
  high_fix_max_days?: number;
  kev_max_days?: number | null;
}

export interface Feed {
  status: 'fresh' | 'cached' | 'missing' | 'disabled';
  url?: string;
  version?: string;
  model?: string;
  /** the date of the data (KEV catalogue release, EPSS score date) and its age on the day of the run */
  date?: string;
  age_days?: number;
  error?: string;
}

export interface ScanFeeds {
  kev?: Feed;
  epss?: Feed;
  /** first_seen counts from this day (the first run of wazuh-oneke 0.20.0) */
  tracking_since?: string;
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
  /** CRITICAL and HIGH, plus any severity that is in CISA KEV */
  vulns: Vulnerability[];
  /** wazuh-oneke 0.20.0+ */
  context?: ScanContext | null;
  feeds?: ScanFeeds | null;
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
