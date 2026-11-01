import { GitHubFiles, refuse, type VmPolicy, vmFileName, workspaceState } from './clusterVms';

const policy: VmPolicy = {
  images: { 'ubuntu-22.04-cis': 'oneke-cis' },
  sizes: { small: { cpu: 1, memory_mb: 2048, disk_gb: 20 }, medium: { cpu: 2, memory_mb: 4096, disk_gb: 40 } },
  limits: { vms: 2, cpu: 3, memory_mb: 8192 },
};
const existing = [{ zone: 'nato', program: 'sirtap', name: 'a', size: 'medium', image: 'ubuntu-22.04-cis' }];
const req = (over: Record<string, string>) => ({ zone: 'nato', program: 'sirtap', name: 'tools', size: 'small', image: 'ubuntu-22.04-cis', ...over });

describe('VMs of the console as code', () => {
  it('refuses what the chart would refuse', () => {
    const programs = ['nato/sirtap'];
    expect(refuse(policy, existing, req({}), programs)).toBeUndefined();
    expect(refuse(policy, existing, req({ name: 'Tools' }), programs)).toMatch(/name/);
    expect(refuse(policy, existing, req({ program: 'cistest' }), programs)).toMatch(/no programme/);
    expect(refuse(policy, existing, req({ size: 'huge' }), programs)).toMatch(/size/);
    expect(refuse(policy, existing, req({ image: 'windows' }), programs)).toMatch(/image/);
    expect(refuse(policy, existing, req({ name: 'a' }), programs)).toMatch(/already/);
    expect(refuse(policy, existing, req({ size: 'medium' }), programs)).toMatch(/cpu 3/);
    expect(vmFileName(req({}))).toBe('nato-sirtap-tools.json');
  });

  it('writes and deletes files through the GitHub contents API', async () => {
    const calls: Array<{ url: string; method?: string; body?: Record<string, unknown> }> = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (!init?.method && url.includes('/vms?')) return new Response(JSON.stringify([{ name: 'x.json', path: 'p/x.json', sha: 's', type: 'file' }, { name: 'README.md', path: 'p/README.md', sha: 'r', type: 'file' }]));
      return new Response('{}');
    }) as unknown as typeof fetch;
    const gh = new GitHubFiles('javivillar/refresquito-services', 'main', 't', fake);
    expect((await gh.list('charts/console-vms-oneke/vms')).map(f => f.name)).toEqual(['x.json', 'README.md']);
    await gh.put('charts/console-vms-oneke/vms/nato-sirtap-tools.json', '{}', 'console: create VM');
    await gh.remove('charts/console-vms-oneke/vms/nato-sirtap-tools.json', 's1', 'console: delete VM');
    expect(calls[1]).toMatchObject({ method: 'PUT', body: { message: 'console: create VM', branch: 'main' } });
    expect(calls[1].body).not.toHaveProperty('sha');
    expect(calls[2]).toMatchObject({ method: 'DELETE', body: { sha: 's1', branch: 'main' } });
  });

  it('opens a pull request: branch, commits, pull; finds the open ones of the console', async () => {
    const calls: Array<{ url: string; method?: string; body?: Record<string, unknown> }> = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('/git/ref/heads/main')) return new Response(JSON.stringify({ object: { sha: 'base' } }));
      if (url.includes('/contents/') && !init?.method) return url.includes('old.json') ? new Response(JSON.stringify({ sha: 'o1' })) : new Response('{}', { status: 404 });
      if (url.endsWith('/pulls') && init?.method === 'POST') return new Response(JSON.stringify({ number: 7, html_url: 'https://github.com/x/pull/7' }));
      if (url.includes('/pulls?state=open')) return new Response(JSON.stringify([{ number: 7, title: 't', html_url: 'u', created_at: 'c', head: { ref: 'console/vm-new-a-1' } }, { number: 8, title: 'other', html_url: 'u', created_at: 'c', head: { ref: 'feature' } }]));
      return new Response('{}');
    }) as unknown as typeof fetch;
    const gh = new GitHubFiles('javivillar/opennebula', 'main', 't', fake);
    const pr = await gh.pullRequest('seg-occar-a400m', 'console: new segregation', 'body', [{ path: 'configuration/new.json', text: '{}' }, { path: 'configuration/old.json', text: null }]);
    expect(pr).toEqual({ number: 7, url: 'https://github.com/x/pull/7' });
    const branch = String(calls[1].body?.ref).replace('refs/heads/', '');
    expect(branch).toMatch(/^console\/seg-occar-a400m-/);
    expect(calls[1]).toMatchObject({ method: 'POST', body: { sha: 'base' } });
    expect(calls.find(c => c.method === 'PUT')?.body).toMatchObject({ branch });
    expect(calls.find(c => c.method === 'DELETE')?.body).toMatchObject({ branch, sha: 'o1' });
    expect(calls.at(-1)?.body).toMatchObject({ head: branch, base: 'main' });
    expect((await gh.openPulls()).map(p => p.number)).toEqual([7]);
  });

  it('reads the state of a VM from its Workspace', () => {
    expect(workspaceState({ metadata: { name: 'vm' }, status: { conditions: [{ type: 'Synced', status: 'True' }, { type: 'Ready', status: 'True' }], atProvider: { outputs: { ip: '10.102.101.30' } } } }))
      .toEqual({ synced: true, ready: true, message: undefined, outputs: { ip: '10.102.101.30' } });
    expect(workspaceState({ metadata: { name: 'vm' }, status: { conditions: [{ type: 'Synced', status: 'False', message: 'quota exceeded' }] } }).message).toBe('quota exceeded');
  });
});
