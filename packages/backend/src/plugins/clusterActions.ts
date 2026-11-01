/**
 * Actions of the console on what Argo CD deploys: sync an application with git, restart a workload. They go through
 * the Argo CD API with the credentials Backstage already has for the Argo CD plugin (argocd.appLocatorMethods), so
 * Backstage gets no write access to Kubernetes and Argo CD keeps the cluster equal to git. Who may act: the groups of
 * console.actions.groups (default backstage-admin); later, per resource (its owner).
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
