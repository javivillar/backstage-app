import { findReleaseSbom, parseReleaseRef } from './releases';

const BOM = { bomFormat: 'CycloneDX', specVersion: '1.6', components: [{ type: 'library', name: 'refresquito-fastapi', version: '3.1.0' }] };

function github(assets: Array<{ name: string; size: number }>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${url} ${(init?.headers as Record<string, string>)?.Authorization ?? ''}`);
    if (url === 'https://api.github.com/repos/owner/lib/releases/tags/v3.1.0') {
      return new Response(JSON.stringify({ html_url: 'https://github.com/owner/lib/releases/tag/v3.1.0', published_at: '2026-10-17T10:00:00Z',
        assets: assets.map((a, i) => ({ ...a, url: `https://api.github.com/repos/owner/lib/releases/assets/${i}` })) }), { status: 200 });
    }
    if (url.startsWith('https://api.github.com/repos/owner/lib/releases/assets/')) return new Response(JSON.stringify(BOM), { status: 200 });
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('release SBOMs', () => {
  it('reads owner/repo@tag', () => {
    expect(parseReleaseRef('owner/lib@v3.1.0')).toEqual({ owner: 'owner', repo: 'lib', tag: 'v3.1.0' });
    expect(() => parseReleaseRef('owner/lib')).toThrow(/owner\/repo@tag/);
    expect(() => parseReleaseRef('../x@v1')).toThrow();
  });

  it('downloads the .cdx.json of the release with the token', async () => {
    const { fetchImpl, calls } = github([{ name: 'lib-3.1.0.whl', size: 10 }, { name: 'lib-v3.1.0.cdx.json', size: 10 }]);
    const found = await findReleaseSbom('owner/lib@v3.1.0', 'T', fetchImpl);
    expect(found).toMatchObject({ asset: 'lib-v3.1.0.cdx.json', published: '2026-10-17T10:00:00Z', bom: BOM });
    expect(calls.every(c => c.endsWith('Bearer T'))).toBe(true);
  });

  it('says there is none when the release has no SBOM file, and 404 when there is no release', async () => {
    const { fetchImpl } = github([{ name: 'lib-3.1.0.whl', size: 10 }]);
    expect(await findReleaseSbom('owner/lib@v3.1.0', 'T', fetchImpl)).toBeUndefined();
    await expect(findReleaseSbom('owner/lib@v9.9.9', 'T', fetchImpl)).rejects.toThrow(/no release/);
  });
});
