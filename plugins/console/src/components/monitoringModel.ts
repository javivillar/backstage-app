import type { Entity } from '@backstage/catalog-model';
import { GRAFANA_FOLDER, GRAFANA_LOGS, GRAFANA_PERFORMANCE, GRAFANA_URL, type GrafanaKind, type Range } from './EntityGrafana';

/**
 * Portal › Support › Monitoring: the Grafana dashboards of every Refresquito service and business application.
 *
 * Services come from the Domain of the stack: the app-of-apps (refresquito-services) gives it the annotations below,
 * with the dashboards of each folder Services/<service>/<environment>. Applications come from their deployments
 * (the annotations refresquito.io/grafana-* of the block monitoring, one entity per stage).
 */
export const GRAFANA_SERVICES = 'refresquito.io/grafana-services';
export const GRAFANA_ENVIRONMENT = 'refresquito.io/grafana-environment';
const NAMESPACE = 'refresquito.io/namespace';
const APPLICATION = 'refresquito.io/application';
const STAGE = 'refresquito.io/stage';
const SEGMENT = 'refresquito.io/segment';
const STAGES = ['pro', 'pre', 'dev'];

export type Dashboard = { uid: string; title: string; kind: GrafanaKind };
export type Env = { env: string; folder: string; dashboards: Dashboard[]; namespace?: string; entityRef?: string };
export type Target = {
  scope: 'services' | 'applications';
  name: string;
  title: string;
  group: string;
  owner?: string;
  envs: Env[];
};
export type Monitoring = { base?: string; services: Target[]; applications: Target[] };

type ServiceEntry = { name?: unknown; component?: unknown; segment?: unknown; dashboards?: unknown };

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const refOf = (e: Entity) => `${e.kind.toLowerCase()}:${e.metadata.namespace ?? 'default'}/${e.metadata.name}`;

/** The dashboards of one service entry, keeping only well-formed ones. */
function dashboardsOf(v: unknown): Dashboard[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap(d => {
    const uid = str(d?.uid);
    if (!uid) return [];
    return [{ uid, title: str(d.title) ?? uid, kind: d.kind === 'logs' ? 'logs' : 'performance' } as Dashboard];
  });
}

/** The services of the Domain annotation; an unreadable annotation gives none. */
export function servicesOf(domain: Entity | undefined, components: Entity[]): Target[] {
  const ann = domain?.metadata.annotations ?? {};
  let entries: ServiceEntry[] = [];
  try {
    const parsed = JSON.parse(ann[GRAFANA_SERVICES] ?? '[]');
    entries = Array.isArray(parsed) ? parsed : [];
  } catch {
    entries = [];
  }
  const env = ann[GRAFANA_ENVIRONMENT] || 'pro';
  const byName = new Map(components.map(c => [c.metadata.name, c]));
  return entries.flatMap(s => {
    const name = str(s.name);
    if (!name) return [];
    const component = byName.get(str(s.component) ?? '');
    return [{
      scope: 'services' as const,
      name,
      title: component?.metadata.annotations?.['refresquito.io/product'] ?? component?.metadata.title ?? name,
      group: str(s.segment) ?? 'platform',
      envs: [{
        env,
        folder: `Services / ${name} / ${env}`,
        dashboards: dashboardsOf(s.dashboards),
        namespace: component?.metadata.annotations?.[NAMESPACE],
        entityRef: component ? refOf(component) : undefined,
      }],
    }];
  });
}

/** The business applications: their deployments with the block monitoring, grouped by application, pro first. */
export function applicationsOf(components: Entity[]): Target[] {
  const apps = new Map<string, Target>();
  for (const c of components) {
    const ann = c.metadata.annotations ?? {};
    const folder = ann[GRAFANA_FOLDER] ?? '';
    if (!ann[GRAFANA_URL] || !folder.startsWith('Applications')) continue;
    const name = ann[APPLICATION] || c.metadata.name;
    const env = ann[STAGE] || 'pro';
    const dashboards: Dashboard[] = [];
    if (ann[GRAFANA_PERFORMANCE]) dashboards.push({ uid: ann[GRAFANA_PERFORMANCE], title: 'Performance', kind: 'performance' });
    if (ann[GRAFANA_LOGS]) dashboards.push({ uid: ann[GRAFANA_LOGS], title: 'Logs', kind: 'logs' });
    const app: Target = apps.get(name) ?? {
      scope: 'applications',
      name,
      title: name,
      group: c.metadata.labels?.[SEGMENT] ?? 'applications',
      owner: str((c.spec as { owner?: unknown } | undefined)?.owner),
      envs: [],
    };
    app.envs.push({ env, folder, dashboards, namespace: ann[NAMESPACE], entityRef: refOf(c) });
    apps.set(name, app);
  }
  const rank = (e: string) => (STAGES.indexOf(e) < 0 ? 99 : STAGES.indexOf(e));
  return [...apps.values()]
    .map(a => ({ ...a, envs: a.envs.sort((x, y) => rank(x.env) - rank(y.env)) }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** The base URL of Grafana: the Domain's, else the first deployment that says it. */
export function grafanaBase(domain: Entity | undefined, components: Entity[]): string | undefined {
  return domain?.metadata.annotations?.[GRAFANA_URL] ?? components.map(c => c.metadata.annotations?.[GRAFANA_URL]).find(Boolean);
}

/** The name of a Grafana group as the access job of observability-oneke makes it (grafana-access.py slug). */
export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');

/**
 * Whether the user may see a target here: a member of grafana-<name>-editors or -viewers, the owner team of an
 * application, or a group that may act in the console. Grafana still applies its own permissions inside the frame.
 */
export function canSee(target: Target, refs: Set<string>, admin: boolean): boolean {
  if (admin) return true;
  const n = slug(target.name);
  if (refs.has(`group:default/grafana-${n}-viewers`) || refs.has(`group:default/grafana-${n}-editors`)) return true;
  const owner = target.owner?.toLowerCase();
  if (!owner) return false;
  return refs.has(owner.includes(':') ? owner : `group:default/${owner}`);
}

/** Grafana Explore on the namespace of a target: Loki for logs, Prometheus (the default source) for performance. */
export function exploreUrl(base: string, kind: GrafanaKind, namespace: string, range: Range): string {
  const expr =
    kind === 'logs'
      ? `{namespace="${namespace}"}`
      : `sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="${namespace}", container!=""}[5m]))`;
  const left = [`now-${range}`, 'now', kind === 'logs' ? 'Loki' : 'Prometheus', { expr }];
  return `${base.replace(/\/+$/, '')}/explore?left=${encodeURIComponent(JSON.stringify(left))}`;
}

/** Group targets by their group (segment), groups and targets by name. */
export function grouped(targets: Target[]): Array<{ group: string; items: Target[] }> {
  const m = new Map<string, Target[]>();
  for (const t of targets) m.set(t.group, [...(m.get(t.group) ?? []), t]);
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([group, items]) => ({ group, items: items.sort((a, b) => a.title.localeCompare(b.title)) }));
}
