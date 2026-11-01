/**
 * The VMs requested from the console (Zone > Virtual machines), as code: one JSON file per VM in
 * charts/console-vms-oneke/vms of refresquito-services (main, no pull request: the user's decision). Argo CD syncs
 * that chart in this cluster and Crossplane (provider-terraform) creates the VM in OpenNebula; how a VM is built and
 * what it may be is in the chart and its policy.json. The checks here repeat the chart's, so a request that would
 * fail is refused at once; the state of each VM is read from its Workspace.
 */

export type VmPolicy = {
  images: Record<string, string>;
  sizes: Record<string, { cpu: number; memory_mb: number; disk_gb: number }>;
  limits: { vms?: number; cpu?: number; memory_mb?: number };
};
export type VmRequest = { zone: string; program: string; name: string; size: string; image: string; requested_by?: string; requested_at?: string };

export const VM_NAME = /^[a-z0-9]([-a-z0-9]{0,30}[a-z0-9])?$/;
export const vmFileName = (v: { zone: string; program: string; name: string }) => `${v.zone}-${v.program}-${v.name}.json`;

/** Why a new request cannot be accepted, or undefined. programs: "zone/program" managed from this console. */
export function refuse(policy: VmPolicy, existing: VmRequest[], v: VmRequest, programs: string[]): string | undefined {
  if (!VM_NAME.test(v.name)) return 'The name: lowercase letters, digits and "-", up to 32.';
  if (!programs.includes(`${v.zone}/${v.program}`)) return `There is no programme ${v.zone}/${v.program} managed from this console.`;
  if (!policy.sizes[v.size]) return `The size is one of ${Object.keys(policy.sizes).join(', ')}.`;
  if (!policy.images[v.image]) return `The image is one of ${Object.keys(policy.images).join(', ')}.`;
  if (existing.some(x => x.zone === v.zone && x.program === v.program && x.name === v.name)) return `There is already a VM ${v.name} in ${v.program}.`;
  const mine = existing.filter(x => x.zone === v.zone && x.program === v.program);
  const size = policy.sizes[v.size];
  const used = {
    vms: mine.length + 1,
    cpu: mine.reduce((t, x) => t + (policy.sizes[x.size]?.cpu ?? 0), 0) + size.cpu,
    memory_mb: mine.reduce((t, x) => t + (policy.sizes[x.size]?.memory_mb ?? 0), 0) + size.memory_mb,
  };
  const over = (['vms', 'cpu', 'memory_mb'] as const).filter(k => policy.limits[k] !== undefined && used[k] > policy.limits[k]!);
  if (over.length) return `Over the limits of the programme: ${over.map(k => `${k} ${policy.limits[k]}`).join(', ')}.`;
  return undefined;
}

/** Files of a GitHub repository through the contents API: one commit per change. */
export class GitHubFiles {
  constructor(
    private readonly repo: string,
    private readonly branch: string,
    private readonly token: string | undefined,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private headers() {
    return { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) };
  }

  private url(path: string) {
    return `https://api.github.com/repos/${this.repo}/contents/${path}`;
  }

  private async check(res: Response, what: string) {
    if (res.ok) return;
    if (res.status === 409 || res.status === 422) throw new Error(`Someone changed ${what} at the same time: try again.`);
    throw new Error(`GitHub answered ${res.status} for ${this.repo}/${what}${res.status === 403 || res.status === 404 ? ' (does the token of Backstage have Contents: write on it?)' : ''}`);
  }

  async get(path: string): Promise<{ text: string; sha: string }> {
    const res = await this.fetchFn(`${this.url(path)}?ref=${encodeURIComponent(this.branch)}`, { headers: this.headers() });
    await this.check(res, path);
    const body = (await res.json()) as { content: string; sha: string };
    return { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: body.sha };
  }

  /** The files of a folder (name, path, sha); [] when the folder does not exist. */
  async list(dir: string): Promise<Array<{ name: string; path: string; sha: string }>> {
    const res = await this.fetchFn(`${this.url(dir)}?ref=${encodeURIComponent(this.branch)}`, { headers: this.headers() });
    if (res.status === 404) return [];
    await this.check(res, dir);
    return ((await res.json()) as Array<{ name: string; path: string; sha: string; type: string }>).filter(f => f.type === 'file');
  }

  async put(path: string, text: string, message: string, sha?: string): Promise<void> {
    const res = await this.fetchFn(this.url(path), {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, branch: this.branch, content: Buffer.from(text, 'utf8').toString('base64'), ...(sha ? { sha } : {}) }),
    });
    await this.check(res, path);
  }

  async remove(path: string, sha: string, message: string): Promise<void> {
    const res = await this.fetchFn(this.url(path), {
      method: 'DELETE',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, branch: this.branch, sha }),
    });
    await this.check(res, path);
  }
}

/** What Crossplane says of a VM: its Workspace (tf.m.crossplane.io) summarised. */
export type VmState = { synced?: boolean; ready?: boolean; message?: string; outputs?: Record<string, unknown> };
type WorkspaceObj = {
  metadata: { name: string; labels?: Record<string, string> };
  status?: { conditions?: Array<{ type: string; status: string; message?: string; reason?: string }>; atProvider?: { outputs?: Record<string, unknown> } };
};

export function workspaceState(w: WorkspaceObj): VmState {
  const c = (t: string) => w.status?.conditions?.find(x => x.type === t);
  const bad = (w.status?.conditions ?? []).find(x => x.status === 'False' && x.message);
  return {
    synced: c('Synced') ? c('Synced')!.status === 'True' : undefined,
    ready: c('Ready') ? c('Ready')!.status === 'True' : undefined,
    message: bad?.message?.slice(0, 400),
    outputs: w.status?.atProvider?.outputs,
  };
}
