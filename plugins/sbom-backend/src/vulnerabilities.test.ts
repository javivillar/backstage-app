import { findImageScan } from './vulnerabilities';

const SCAN = {
  digest: 'sha256:abc',
  image: 'ghcr.io/owner/app-api:1234567',
  status: 'scanned',
  counts: { CRITICAL: 1, HIGH: 1 },
  vulns: [{ id: 'CVE-2026-1', sev: 'CRITICAL', pkg: 'openssl', ver: '3.0.1', fix: '3.0.2' }],
};

function exporter(known: Record<string, unknown>, status = 200) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (status !== 200) return new Response('', { status });
    const query = url.split('?')[1];
    return query in known ? new Response(JSON.stringify(known[query]), { status: 200 }) : new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('image scan', () => {
  it('reads the scan of the digest', async () => {
    const { fetchImpl, calls } = exporter({ 'digest=sha256%3Aabc': SCAN });
    expect(await findImageScan('http://exporter:9950/', 'sha256:abc', SCAN.image, fetchImpl)).toEqual(SCAN);
    expect(calls).toEqual(['http://exporter:9950/vulnerabilities?digest=sha256%3Aabc']);
  });

  it('falls back to the image reference, and says there is none', async () => {
    const { fetchImpl, calls } = exporter({ [`image=${encodeURIComponent(SCAN.image)}`]: SCAN });
    expect(await findImageScan('http://exporter:9950', 'sha256:other', SCAN.image, fetchImpl)).toEqual(SCAN);
    expect(calls).toHaveLength(2);
    expect(await findImageScan('http://exporter:9950', 'sha256:other', 'ghcr.io/owner/x:1', fetchImpl)).toBeUndefined();
  });

  it('fails when the exporter fails', async () => {
    const { fetchImpl } = exporter({}, 503);
    await expect(findImageScan('http://exporter:9950', 'sha256:abc', SCAN.image, fetchImpl)).rejects.toThrow(/503/);
  });
});
