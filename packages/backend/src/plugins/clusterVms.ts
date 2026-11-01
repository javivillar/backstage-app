/**
 * The VMs requested from the console (Zone > Virtual machines), kept in vms.json of the opennebula repository and
 * applied by the OpenNebula host every 2 minutes (configuration/vms.py, timer one-vms-apply). The console only writes
 * the request to git (main, no pull request: the user's decision); the host creates the VM on the private network of
 * its programme. The rules here repeat the host's so that a request that would be refused is refused at once.
 */

export type VmRequest = {
  zone: string;
  program: string;
  name: string;
  size: string;
  image: string;
  state: 'running' | 'stopped' | 'deleted';
  requested_by?: string;
  requested_at?: string;
};
export type VmSpec = {
  _doc?: string;
  limits: { vms?: number; cpu?: number; memory_mb?: number; host_reserve_mb?: number };
  sizes: Record<string, { cpu: number; memory_mb: number; disk_gb: number }>;
  images: Record<string, string>;
  vms: VmRequest[];
};

export const VM_NAME = /^[a-z0-9]([-a-z0-9]{0,30}[a-z0-9])?$/;

/** Why a new request cannot be accepted, or undefined when it can. programs: "zone/program" that exist. */
export function refuse(spec: VmSpec, v: Omit<VmRequest, 'state'>, programs: string[]): string | undefined {
  if (!VM_NAME.test(v.name)) return 'The name: lowercase letters, digits and "-", up to 32.';
  if (!programs.includes(`${v.zone}/${v.program}`)) return `There is no programme ${v.zone}/${v.program}.`;
  if (!spec.sizes[v.size]) return `The size is one of ${Object.keys(spec.sizes).join(', ')}.`;
  if (!spec.images[v.image]) return `The image is one of ${Object.keys(spec.images).join(', ')}.`;
  if (spec.vms.some(x => x.zone === v.zone && x.program === v.program && x.name === v.name && x.state !== 'deleted')) return `There is already a VM ${v.name} in ${v.program}.`;
  const mine = spec.vms.filter(x => x.zone === v.zone && x.program === v.program && x.state !== 'deleted');
  const size = spec.sizes[v.size];
  const used = {
    vms: mine.length + 1,
    cpu: mine.reduce((t, x) => t + (spec.sizes[x.size]?.cpu ?? 0), 0) + size.cpu,
    memory_mb: mine.reduce((t, x) => t + (spec.sizes[x.size]?.memory_mb ?? 0), 0) + size.memory_mb,
  };
  const over = (['vms', 'cpu', 'memory_mb'] as const).filter(k => spec.limits[k] !== undefined && used[k] > spec.limits[k]!);
  if (over.length) return `Over the limits of the programme: ${over.map(k => `${k} ${spec.limits[k]}`).join(', ')}.`;
  return undefined;
}

/** vms.json in a GitHub repository, read and written through the contents API (one commit per change). */
export class VmFile {
  constructor(
    private readonly repo: string,
    private readonly path: string,
    private readonly branch: string,
    private readonly token: string | undefined,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private headers() {
    return { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) };
  }

  private url() {
    return `https://api.github.com/repos/${this.repo}/contents/${this.path}`;
  }

  async read(): Promise<{ spec: VmSpec; sha: string }> {
    const res = await this.fetchFn(`${this.url()}?ref=${encodeURIComponent(this.branch)}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} reading ${this.repo}/${this.path}`);
    const body = (await res.json()) as { content: string; sha: string };
    return { spec: JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')) as VmSpec, sha: body.sha };
  }

  async write(spec: VmSpec, sha: string, message: string): Promise<void> {
    const res = await this.fetchFn(this.url(), {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, branch: this.branch, sha, content: Buffer.from(`${JSON.stringify(spec, null, 2)}\n`, 'utf8').toString('base64') }),
    });
    if (res.status === 409) throw new Error('Someone changed the VMs at the same time: try again.');
    if (!res.ok) throw new Error(`GitHub answered ${res.status} writing ${this.repo}/${this.path} (does the token of Backstage have Contents: write on it?)`);
  }
}
