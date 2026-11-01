/**
 * Actions of the console on what Argo CD deploys: sync an application with git, restart a workload. They go through
 * the Argo CD API with the credentials Backstage already has for the Argo CD plugin (argocd.appLocatorMethods), so
 * Backstage gets no write access to Kubernetes and Argo CD keeps the cluster equal to git. Who may act: the groups of
 * console.actions.groups (default backstage-admin) on anything; with console.actions.owners: true (default false), also
 * the owner of an entity on its own namespace and Argo CD application.
 */

export type ArgoInstance = { url: string; token?: string; username?: string; password?: string };
export type ActionRecord = { at: string; user: string; action: string; target: string; result: 'done' | 'failed'; message?: string };

export const WORKLOAD_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet'] as const;
export const NAME = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;

/** Whether one of the user's ownership refs is in the allowed groups (names or refs, any case). */
export function mayAct(ownershipRefs: string[], groups: string[]): boolean {
  const want = new Set(groups.map(g => (g.includes(':') ? g : `group:default/${g}`).toLowerCase()));
  return ownershipRefs.some(r => want.has(r.toLowerCase()));
}

/** The owner of an entity as an entity ref (spec.owner may be "team", "group:team" or "group:default/team"). */
export function ownerRef(owner?: string): string | undefined {
  if (!owner) return undefined;
  const o = owner.toLowerCase();
  if (!o.includes(':')) return `group:default/${o}`;
  return o.includes('/') ? o : o.replace(':', ':default/');
}

/** Whether the user owns the entity (one of their ownership refs is its owner). */
export function ownsEntity(ownershipRefs: string[], owner?: string): boolean {
  const ref = ownerRef(owner);
  return !!ref && ownershipRefs.some(r => r.toLowerCase() === ref);
}

export class ArgoClient {
  private token?: { value: string; until: number };

  constructor(private readonly instance: ArgoInstance, private readonly fetchFn: typeof fetch = fetch) {}

  private async bearer(): Promise<string> {
    if (this.instance.token) return this.instance.token;
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const res = await this.fetchFn(`${this.instance.url}/api/v1/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.instance.username, password: this.instance.password }),
    });
    if (!res.ok) throw new Error(`Argo CD refused the login (${res.status})`);
    const body = (await res.json()) as { token?: string };
    if (!body.token) throw new Error('Argo CD gave no token');
    this.token = { value: body.token, until: Date.now() + 10 * 60_000 };
    return body.token;
  }

  private async call(path: string, body: unknown): Promise<void> {
    const res = await this.fetchFn(`${this.instance.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await this.bearer()}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let message = text;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        // plain text
      }
      throw new Error(`Argo CD answered ${res.status}: ${message.slice(0, 300)}`);
    }
  }

  /** An application as the console shows it: its deployments (history), state and resources. Read only. */
  async app(name: string): Promise<ArgoAppView> {
    const res = await this.fetchFn(`${this.instance.url}/api/v1/applications/${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${await this.bearer()}` } });
    if (res.status === 404 || res.status === 403) throw Object.assign(new Error(`No Argo CD application ${name}`), { status: 404 });
    if (!res.ok) throw new Error(`Argo CD answered ${res.status}`);
    return argoAppView((await res.json()) as ArgoAppRaw);
  }

  /** Sync the application with git now (no prune: a deletion stays a decision of git and Argo CD's own policy). */
  sync(app: string) {
    return this.call(`/api/v1/applications/${encodeURIComponent(app)}/sync`, { prune: false });
  }

  /** The built-in restart action of Argo CD on a Deployment, StatefulSet or DaemonSet of the application. */
  restart(app: string, namespace: string, kind: string, name: string) {
    return this.call(`/api/v1/applications/${encodeURIComponent(app)}/resource/actions/v2`, {
      namespace,
      resourceName: name,
      version: 'v1',
      kind,
      group: 'apps',
      action: 'restart',
    });
  }
}

type ArgoAppRaw = {
  metadata: { name: string };
  spec?: { source?: { repoURL?: string; path?: string; targetRevision?: string } };
  status?: {
    sync?: { status?: string; revision?: string };
    health?: { status?: string };
    history?: Array<{ id: number; revision?: string; deployedAt?: string; deployStartedAt?: string; initiatedBy?: { username?: string; automated?: boolean } }>;
    operationState?: { phase?: string; message?: string; finishedAt?: string };
    resources?: Array<{ kind: string; name: string; namespace?: string; status?: string; health?: { status?: string } }>;
  };
};
export type ArgoAppView = {
  name: string;
  repo?: string;
  path?: string;
  target?: string;
  sync?: string;
  revision?: string;
  health?: string;
  operation?: { phase?: string; message?: string; finishedAt?: string };
  history: Array<{ id: number; revision?: string; deployedAt?: string; took?: number; by?: string }>;
  resources: Array<{ kind: string; name: string; namespace?: string; sync?: string; health?: string }>;
};

/** The parts of an Argo CD application the console shows, newest deployment first. */
export function argoAppView(a: ArgoAppRaw): ArgoAppView {
  const st = a.status ?? {};
  return {
    name: a.metadata.name,
    repo: a.spec?.source?.repoURL,
    path: a.spec?.source?.path,
    target: a.spec?.source?.targetRevision,
    sync: st.sync?.status,
    revision: st.sync?.revision,
    health: st.health?.status,
    operation: st.operationState ? { phase: st.operationState.phase, message: st.operationState.message?.slice(0, 300), finishedAt: st.operationState.finishedAt } : undefined,
    history: [...(st.history ?? [])]
      .reverse()
      .slice(0, 20)
      .map(h => ({
        id: h.id,
        revision: h.revision,
        deployedAt: h.deployedAt,
        took: h.deployedAt && h.deployStartedAt ? Math.round((Date.parse(h.deployedAt) - Date.parse(h.deployStartedAt)) / 1000) : undefined,
        by: h.initiatedBy?.automated ? 'auto-sync' : h.initiatedBy?.username,
      })),
    resources: (st.resources ?? []).map(r => ({ kind: r.kind, name: r.name, namespace: r.namespace, sync: r.status, health: r.health?.status })),
  };
}
