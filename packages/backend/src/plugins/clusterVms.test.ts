import { type ComponentRequest, componentName, GitHubFiles, refuse, refuseComponent, type VmPolicy, type VmRequest, vmFileName, workspaceState } from './clusterVms';

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

const withComponents: VmPolicy = {
  ...policy,
  components: {
    apisix: { image: 'refresquito-apisix-coraza-ubuntu2404-0.1.4', kinds: ['landing', 'integration'], traffic: ['u2m', 'm2m'], cpu: [1, 2, 4], memory_mb: [2048, 4096, 8192], disk_gb: [20, 40, 80], cpu_model: 'host-passthrough' },
    sftpgo: { image: 'refresquito-sftpgo-ubuntu2404-0.1.2', kinds: ['landing'], cpu: [1, 2, 4], memory_mb: [2048, 4096, 8192], disk_gb: [20, 50, 100] },
    kafka: { image: 'refresquito-kafka-ubuntu2404-0.1.0', kinds: ['landing'], cpu: [1, 2, 4], memory_mb: [2048, 4096, 8192], disk_gb: [10, 20, 40] },
  },
  component_limits: { vms: 3, cpu: 8, memory_mb: 16384 }, // smaller than the chart's (6, 16, 32768) to test them,
};
const comp = (over: Partial<ComponentRequest> = {}): ComponentRequest => ({ zone: 'nato', program: 'landing', component: 'apisix', traffic: 'm2m', cpu: 2, memory_mb: 4096, disk_gb: 20, ...over });

describe('interconnection components as VM files', () => {
  const programs = ['nato/sirtap', 'nato/landing', 'occar/integration'];

  it('accepts what the chart accepts', () => {
    expect(refuseComponent(withComponents, [], comp(), programs)).toBeUndefined();
    expect(refuseComponent(withComponents, [], comp({ component: 'sftpgo', traffic: undefined, disk_gb: 50 }), programs)).toBeUndefined();
    expect(refuseComponent(withComponents, [], comp({ zone: 'occar', program: 'integration', traffic: 'u2m' }), programs)).toBeUndefined();
  });

  it('refuses what the chart would refuse', () => {
    expect(refuseComponent(policy, [], comp(), programs)).toMatch(/not available yet/);
    expect(refuseComponent({ ...policy, components: {} }, [], comp(), programs)).toMatch(/not available yet/);
    expect(refuseComponent(withComponents, [], comp({ program: 'sirtap' }), programs)).toMatch(/landing zone .* or the integration zone/);
    expect(refuseComponent(withComponents, [], comp({ zone: 'diflim' }), programs)).toMatch(/no landing zone in diflim yet/);
    expect(refuseComponent(withComponents, [], comp({ component: 'nginx' }), programs)).toMatch(/one of apisix, sftpgo, kafka/);
    expect(refuseComponent(withComponents, [], comp({ zone: 'occar', program: 'integration', component: 'kafka', traffic: undefined }), programs)).toMatch(/kafka goes only in landing zones/);
    expect(refuseComponent(withComponents, [], comp({ traffic: undefined }), programs)).toMatch(/traffic of apisix is one of u2m, m2m/);
    expect(refuseComponent(withComponents, [], comp({ traffic: 'b2b' }), programs)).toMatch(/traffic of apisix/);
    expect(refuseComponent(withComponents, [], comp({ component: 'kafka', traffic: 'm2m' }), programs)).toMatch(/kafka has no traffic/);
    expect(refuseComponent(withComponents, [], comp({ cpu: 3 }), programs)).toMatch(/vCPU of apisix is one of 1, 2, 4/);
    expect(refuseComponent(withComponents, [], comp({ memory_mb: 1024 }), programs)).toMatch(/memory \(MB\) of apisix/);
    expect(refuseComponent(withComponents, [], comp({ component: 'sftpgo', traffic: undefined, disk_gb: 10 }), programs)).toMatch(/disk \(GB\) of sftpgo is one of 20, 50, 100/);
    expect(refuseComponent(withComponents, [], comp({ cpu: Number('x') }), programs)).toMatch(/vCPU/);
  });

  it('keeps the components of a segregation within component_limits, apart from the plain VMs', () => {
    const file = (name: string, cpu: number, memory_mb: number): VmRequest => ({ zone: 'nato', program: 'landing', name, component: 'apisix', traffic: 'u2m', cpu, memory_mb, disk_gb: 20 });
    const plain: VmRequest = { zone: 'nato', program: 'landing', name: 'tools', size: 'medium', image: 'ubuntu-22.04-cis' };
    expect(refuseComponent(withComponents, [file('apisix-u2m-0', 4, 8192), plain], comp(), programs)).toBeUndefined();
    expect(refuseComponent(withComponents, [file('apisix-u2m-0', 4, 8192), file('apisix-u2m-1', 4, 4096)], comp(), programs)).toMatch(/Over the limits of the components of nato\/landing: cpu 8/);
    expect(refuseComponent(withComponents, [file('apisix-u2m-0', 1, 8192), file('apisix-u2m-1', 1, 8192)], comp(), programs)).toMatch(/memory_mb 16384/);
    expect(refuseComponent(withComponents, [file('a', 1, 2048), file('b', 1, 2048), file('c', 1, 2048)], comp(), programs)).toMatch(/vms 3/);
    // the components of another zone do not count
    expect(refuseComponent(withComponents, [{ ...file('a', 4, 8192), zone: 'occar' }, { ...file('b', 4, 8192), zone: 'occar' }], comp(), programs)).toBeUndefined();
    // and a plain VM is not counted against the components, nor a component against the plain VMs
    expect(refuse(withComponents, [file('a', 4, 8192), file('b', 4, 8192)], { ...plain, name: 'x', size: 'small' }, programs)).toBeUndefined();
  });

  it('refuses a disk the image does not fit in and numbers sent as text', () => {
    expect(refuseComponent(withComponents, [], comp({ disk_gb: 10 }), programs)).toMatch(/disk \(GB\) of apisix is one of 20, 40, 80/);
    expect(refuseComponent(withComponents, [], comp({ cpu: '2' as unknown as number }), programs)).toMatch(/vCPU/);
  });

  it('names a component <component>[-<traffic>]-<n> with the first free n', () => {
    expect(componentName([], 'apisix', 'm2m')).toBe('apisix-m2m-0');
    expect(componentName(['apisix-m2m-0', 'apisix-u2m-1'], 'apisix', 'm2m')).toBe('apisix-m2m-1');
    expect(componentName(['kafka-0', 'kafka-2'], 'kafka')).toBe('kafka-1');
    expect(vmFileName({ zone: 'nato', program: 'landing', name: componentName([], 'sftpgo') })).toBe('nato-landing-sftpgo-0.json');
  });
});
