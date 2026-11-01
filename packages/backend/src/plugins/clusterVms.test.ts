import { refuse, VmFile, type VmSpec } from './clusterVms';

const spec: VmSpec = {
  limits: { vms: 2, cpu: 3, memory_mb: 8192 },
  sizes: { small: { cpu: 1, memory_mb: 2048, disk_gb: 20 }, medium: { cpu: 2, memory_mb: 4096, disk_gb: 40 } },
  images: { 'ubuntu-22.04-cis': 'oneke-cis' },
  vms: [{ zone: 'nato', program: 'sirtap', name: 'a', size: 'medium', image: 'ubuntu-22.04-cis', state: 'running' }],
};
const req = (over: Record<string, string>) => ({ zone: 'nato', program: 'sirtap', name: 'tools', size: 'small', image: 'ubuntu-22.04-cis', ...over });

describe('VMs requested from the console', () => {
  it('refuses what the host would refuse', () => {
    const programs = ['nato/sirtap'];
    expect(refuse(spec, req({}), programs)).toBeUndefined();
    expect(refuse(spec, req({ name: 'Tools' }), programs)).toMatch(/name/);
    expect(refuse(spec, req({ program: 'cistest' }), programs)).toMatch(/no programme/);
    expect(refuse(spec, req({ size: 'huge' }), programs)).toMatch(/size/);
    expect(refuse(spec, req({ image: 'windows' }), programs)).toMatch(/image/);
    expect(refuse(spec, req({ name: 'a' }), programs)).toMatch(/already/);
    expect(refuse(spec, req({ size: 'medium' }), programs)).toMatch(/cpu 3/);
  });

  it('reads and writes vms.json through the GitHub contents API', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (!init?.method) return new Response(JSON.stringify({ sha: 's1', content: Buffer.from(JSON.stringify(spec)).toString('base64') }));
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const file = new VmFile('javivillar/opennebula', 'configuration/vms.json', 'main', 't', fake);
    const { spec: read, sha } = await file.read();
    expect(read.vms[0].name).toBe('a');
    await file.write({ ...read, vms: [] }, sha, 'console: delete VM a');
    expect(calls[0].url).toBe('https://api.github.com/repos/javivillar/opennebula/contents/configuration/vms.json?ref=main');
    const body = JSON.parse(String(calls[1].init?.body));
    expect(body).toMatchObject({ message: 'console: delete VM a', branch: 'main', sha: 's1' });
    expect(JSON.parse(Buffer.from(body.content, 'base64').toString()).vms).toEqual([]);
  });
});
