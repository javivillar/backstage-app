/**
 * The VMs requested from the console (Zone > Virtual machines), as code: one JSON file per VM in
 * charts/console-vms-oneke/vms of refresquito-services, through a pull request (merged: it is in main). Argo CD syncs
 * that chart in this cluster and Crossplane (provider-terraform) creates the VM in OpenNebula; how a VM is built and
 * what it may be is in the chart and its policy.json. The checks here repeat the chart's, so a request that would
 * fail is refused at once; the state of each VM is read from its Workspace.
 */

/** A component of the interconnection (policy.json "components"): its fixed image and what may be chosen. */
export type ComponentPolicy = { image: string; kinds: string[]; traffic?: string[]; cpu: number[]; memory_mb: number[]; disk_gb: number[]; cpu_model?: string };
export type VmPolicy = {
  images: Record<string, string>;
  sizes: Record<string, { cpu: number; memory_mb: number; disk_gb: number }>;
  limits: { vms?: number; cpu?: number; memory_mb?: number };
  /** missing in a chart older than the interconnection: no component can be asked */
  components?: Record<string, ComponentPolicy>;
  component_limits?: { vms?: number; cpu?: number; memory_mb?: number };
};
/** A VM file: a plain VM (size and image of the policy) or a component (its own cpu, memory and disk; the image is the component's). */
export type VmRequest = {
  zone: string;
  program: string;
  name: string;
  size?: string;
  image?: string;
  component?: string;
  traffic?: string;
  cpu?: number;
  memory_mb?: number;
  disk_gb?: number;
  requested_by?: string;
  requested_at?: string;
};
export type ComponentRequest = { zone: string; program: string; component: string; traffic?: string; cpu: number; memory_mb: number; disk_gb: number };

export const VM_NAME = /^[a-z0-9]([-a-z0-9]{0,30}[a-z0-9])?$/;
export const vmFileName = (v: { zone: string; program: string; name: string }) => `${v.zone}-${v.program}-${v.name}.json`;

/** What a VM file takes of its segregation: a component says it itself, a plain VM through its size. */
const weight = (policy: VmPolicy, x: VmRequest) => ({
  cpu: x.component ? Number(x.cpu ?? 0) : policy.sizes[x.size ?? '']?.cpu ?? 0,
  memory_mb: x.component ? Number(x.memory_mb ?? 0) : policy.sizes[x.size ?? '']?.memory_mb ?? 0,
});

/** Why a new request cannot be accepted, or undefined. programs: "zone/program" managed from this console. */
export function refuse(policy: VmPolicy, existing: VmRequest[], v: VmRequest, programs: string[]): string | undefined {
  if (!VM_NAME.test(v.name)) return 'The name: lowercase letters, digits and "-", up to 32.';
  if (!programs.includes(`${v.zone}/${v.program}`)) return `There is no programme ${v.zone}/${v.program} managed from this console.`;
  if (!v.size || !policy.sizes[v.size]) return `The size is one of ${Object.keys(policy.sizes).join(', ')}.`;
  if (!v.image || !policy.images[v.image]) return `The image is one of ${Object.keys(policy.images).join(', ')}.`;
  if (existing.some(x => x.zone === v.zone && x.program === v.program && x.name === v.name)) return `There is already a VM ${v.name} in ${v.program}.`;
  // the components of a segregation have limits of their own (component_limits)
  const mine = existing.filter(x => x.zone === v.zone && x.program === v.program && !x.component);
  const size = policy.sizes[v.size];
  const used = {
    vms: mine.length + 1,
    cpu: mine.reduce((t, x) => t + weight(policy, x).cpu, 0) + size.cpu,
    memory_mb: mine.reduce((t, x) => t + weight(policy, x).memory_mb, 0) + size.memory_mb,
  };
  const over = (['vms', 'cpu', 'memory_mb'] as const).filter(k => policy.limits[k] !== undefined && used[k] > policy.limits[k]!);
  if (over.length) return `Over the limits of the programme: ${over.map(k => `${k} ${policy.limits[k]}`).join(', ')}.`;
  return undefined;
}

/** The segregations that hold components: the landing zone of a core site, the integration zone of an edge site. */
export const COMPONENT_PROGRAMS: readonly string[] = ['landing', 'integration'];

/**
 * Why a component cannot be asked, or undefined: the rules of the chart for a file with "component" (the component
 * exists and fits the kind of the segregation, traffic for the ones that have it and only for them, cpu, memory and
 * disk from its lists, component_limits per segregation). programs: "zone/program" that exist in this site.
 */
export function refuseComponent(policy: VmPolicy, existing: VmRequest[], v: ComponentRequest, programs: string[]): string | undefined {
  if (!policy.components || !Object.keys(policy.components).length) return 'Interconnection components are not available yet: the policy of console-vms-oneke has no components.';
  if (!COMPONENT_PROGRAMS.includes(v.program)) return 'A component goes in the landing zone (core site) or the integration zone (edge site) of a zone.';
  if (!programs.includes(`${v.zone}/${v.program}`)) return `There is no ${v.program} zone in ${v.zone} yet: create ${v.zone}/${v.program} first (its pull request merged and applied).`;
  const c = policy.components[v.component];
  if (!c) return `The component is one of ${Object.keys(policy.components).join(', ')}.`;
  if (!c.kinds.includes(v.program)) return `${v.component} goes only in ${c.kinds.join(' or ')} zones.`;
  if (c.traffic?.length) {
    if (!v.traffic || !c.traffic.includes(v.traffic)) return `The traffic of ${v.component} is one of ${c.traffic.join(', ')}.`;
  } else if (v.traffic) {
    return `${v.component} has no traffic to choose.`;
  }
  const fields: Array<['cpu' | 'memory_mb' | 'disk_gb', string]> = [['cpu', 'vCPU'], ['memory_mb', 'memory (MB)'], ['disk_gb', 'disk (GB)']];
  for (const [k, label] of fields) {
    if (!c[k].includes(v[k])) return `The ${label} of ${v.component} is one of ${c[k].join(', ')}.`;
  }
  const limits = policy.component_limits ?? {};
  const mine = existing.filter(x => x.zone === v.zone && x.program === v.program && x.component);
  const used = {
    vms: mine.length + 1,
    cpu: mine.reduce((t, x) => t + weight(policy, x).cpu, 0) + v.cpu,
    memory_mb: mine.reduce((t, x) => t + weight(policy, x).memory_mb, 0) + v.memory_mb,
  };
  const over = (['vms', 'cpu', 'memory_mb'] as const).filter(k => limits[k] !== undefined && used[k] > limits[k]!);
  if (over.length) return `Over the limits of the components of ${v.zone}/${v.program}: ${over.map(k => `${k} ${limits[k]}`).join(', ')}.`;
  return undefined;
}

/** The name of a new component: <component>[-<traffic>]-<n>, the first n nobody has (taken: names in git or asked). */
export function componentName(taken: string[], component: string, traffic?: string): string {
  const base = `${component}${traffic ? `-${traffic}` : ''}`;
  for (let n = 0; ; n++) {
    if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
  }
}

/** A file change of a pull request: text to write, or null to delete the file. */
export type FileChange = { path: string; text: string | null };
/** An open pull request of the console. */
export type ConsolePull = { number: number; title: string; url: string; branch: string; created: string; body: string; merged?: string };

/** Branches of the console's pull requests start with this (how the console finds its pending requests). */
export const PR_PREFIX = 'console/';

/** Files of a GitHub repository through the contents API: one commit per change, or a pull request. */
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

  private api(path: string) {
    return `https://api.github.com/repos/${this.repo}/${path}`;
  }

  private async send(url: string, method: string, body: unknown) {
    return this.fetchFn(url, { method, headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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

  /** The sha of a file, or undefined when it does not exist. */
  async sha(path: string, branch = this.branch): Promise<string | undefined> {
    const res = await this.fetchFn(`${this.url(path)}?ref=${encodeURIComponent(branch)}`, { headers: this.headers() });
    if (res.status === 404) return undefined;
    await this.check(res, path);
    return ((await res.json()) as { sha: string }).sha;
  }

  async put(path: string, text: string, message: string, sha?: string, branch = this.branch): Promise<void> {
    const res = await this.send(this.url(path), 'PUT', { message, branch, content: Buffer.from(text, 'utf8').toString('base64'), ...(sha ? { sha } : {}) });
    await this.check(res, path);
  }

  async remove(path: string, sha: string, message: string, branch = this.branch): Promise<void> {
    const res = await this.send(this.url(path), 'DELETE', { message, branch, sha });
    await this.check(res, path);
  }

  /**
   * A pull request against the branch with these changes: a new branch console/<slug>-<time> from it, one commit per
   * file, then the pull request. Returns its number and address.
   */
  async pullRequest(slug: string, title: string, body: string, changes: FileChange[]): Promise<{ number: number; url: string }> {
    const ref = await this.fetchFn(this.api(`git/ref/heads/${encodeURIComponent(this.branch)}`), { headers: this.headers() });
    await this.check(ref, `branch ${this.branch}`);
    const base = ((await ref.json()) as { object: { sha: string } }).object.sha;
    const branch = `${PR_PREFIX}${slug}-${Date.now().toString(36)}`;
    await this.check(await this.send(this.api('git/refs'), 'POST', { ref: `refs/heads/${branch}`, sha: base }), `branch ${branch}`);
    for (const c of changes) {
      const sha = await this.sha(c.path, branch);
      if (c.text === null) {
        if (sha) await this.remove(c.path, sha, title, branch);
      } else {
        await this.put(c.path, c.text, title, sha, branch);
      }
    }
    const pr = await this.send(this.api('pulls'), 'POST', { title, head: branch, base: this.branch, body });
    await this.check(pr, 'pull request');
    const made = (await pr.json()) as { number: number; html_url: string };
    return { number: made.number, url: made.html_url };
  }

  /**
   * A pull request with all its files in ONE commit (git data API: one tree with the contents inline, one commit, the
   * branch, the pull request): five requests whatever the number of files. The contents API (pullRequest) makes a
   * commit per file, and GitHub limits content creation to some 500 requests an hour: an import of thousands of files
   * would take hours. A text of null deletes the file.
   */
  async pullRequestInOneCommit(branch: string, title: string, body: string, changes: FileChange[]): Promise<{ number: number; url: string; branch: string }> {
    const ref = await this.fetchFn(this.api(`git/ref/heads/${encodeURIComponent(this.branch)}`), { headers: this.headers() });
    await this.check(ref, `branch ${this.branch}`);
    const base = ((await ref.json()) as { object: { sha: string } }).object.sha;
    const commit = await this.fetchFn(this.api(`git/commits/${base}`), { headers: this.headers() });
    await this.check(commit, `commit ${base}`);
    const baseTree = ((await commit.json()) as { tree: { sha: string } }).tree.sha;
    const tree = changes.map(c => (c.text === null ? { path: c.path, mode: '100644', type: 'blob', sha: null } : { path: c.path, mode: '100644', type: 'blob', content: c.text }));
    const madeTree = await this.send(this.api('git/trees'), 'POST', { base_tree: baseTree, tree });
    await this.check(madeTree, 'tree');
    const treeSha = ((await madeTree.json()) as { sha: string }).sha;
    const madeCommit = await this.send(this.api('git/commits'), 'POST', { message: title, tree: treeSha, parents: [base] });
    await this.check(madeCommit, 'commit');
    const commitSha = ((await madeCommit.json()) as { sha: string }).sha;
    await this.check(await this.send(this.api('git/refs'), 'POST', { ref: `refs/heads/${branch}`, sha: commitSha }), `branch ${branch}`);
    // GitHub refuses a description over 65,536 characters
    const text = body.length > 60000 ? `${body.slice(0, 60000)}\n\n… (cut: the full list is in the files of this pull request)` : body;
    const pr = await this.send(this.api('pulls'), 'POST', { title, head: branch, base: this.branch, body: text });
    await this.check(pr, 'pull request');
    const made = (await pr.json()) as { number: number; html_url: string };
    return { number: made.number, url: made.html_url, branch };
  }

  /** The pull requests of the console merged in the last `days` days, newest first (their lifecycle after review). */
  async mergedPulls(days = 7): Promise<ConsolePull[]> {
    const res = await this.fetchFn(this.api(`pulls?state=closed&base=${encodeURIComponent(this.branch)}&sort=updated&direction=desc&per_page=50`), { headers: this.headers() });
    await this.check(res, 'pull requests');
    const since = Date.now() - days * 86_400_000;
    const list = (await res.json()) as Array<{ number: number; title: string; html_url: string; created_at: string; merged_at?: string | null; body?: string | null; head: { ref: string } }>;
    return list
      .filter(p => p.head.ref.startsWith(PR_PREFIX) && p.merged_at && Date.parse(p.merged_at) >= since)
      .map(p => ({ number: p.number, title: p.title, url: p.html_url, branch: p.head.ref, created: p.created_at, body: p.body ?? '', merged: p.merged_at! }));
  }

  /** The open pull requests of the console (branch console/...), newest first. */
  async openPulls(): Promise<ConsolePull[]> {
    const res = await this.fetchFn(this.api(`pulls?state=open&base=${encodeURIComponent(this.branch)}&per_page=50`), { headers: this.headers() });
    await this.check(res, 'pull requests');
    const list = (await res.json()) as Array<{ number: number; title: string; html_url: string; created_at: string; body?: string | null; head: { ref: string } }>;
    return list
      .filter(p => p.head.ref.startsWith(PR_PREFIX))
      .map(p => ({ number: p.number, title: p.title, url: p.html_url, branch: p.head.ref, created: p.created_at, body: p.body ?? '' }));
  }
}

/** What Crossplane says of a VM: its Workspace (tf.m.upbound.io) summarised. */
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
