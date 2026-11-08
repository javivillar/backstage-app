/**
 * The templates of Manage › Monitoring: Grafana dashboards an application adds to platform/monitoring/ of its
 * repository from the console. They read only what Prometheus already has of every application, whatever its framework
 * (python-app-oneke or spring-app-oneke): the pods of its databases (<app>-oneke[-<service>]-db-<n>) and their volumes,
 * its CronJobs, the calls of its API to the platform blocks (platform_calls_total of the frameworks) and the metrics its
 * API exposes itself. The provisioner of the application sets the uid, the title prefix (<title> - ) and the variable
 * `namespace` of each stage when it imports the file (python-app-oneke files/provision.py, monitoring()).
 */

export type TemplateId = 'database' | 'jobs' | 'platform' | 'business';
export const TEMPLATES: Array<{ id: TemplateId; title: string; description: string }> = [
  { id: 'database', title: 'Database', description: 'The PostgreSQL pods of the application: CPU, memory, restarts, use of their volumes and disk writes.' },
  { id: 'jobs', title: 'Scheduled jobs', description: 'The CronJobs of the application: hours since their last success, failed and running jobs.' },
  { id: 'platform', title: 'Platform calls', description: 'Calls of the API to the platform blocks (processes, flows, s3, dms…): rate by outcome, errors and p95 latency.' },
  { id: 'business', title: 'Business metrics', description: 'The metrics the API exposes itself in /metrics (not the standard ones): one row per metric, its value and its rate.' },
];

type Panel = Record<string, unknown>;
const PROM = { type: 'prometheus', uid: '${prometheus}' };
const DB_POD = 'pod=~".*-db-[0-9]+"';
const DB_PVC = 'persistentvolumeclaim=~"data-.*-db-[0-9]+"';
const NS = 'namespace="$namespace"';

function panel(
  type: 'timeseries' | 'stat' | 'table',
  title: string,
  gridPos: { x: number; y: number; w: number; h: number },
  targets: Array<{ expr: string; legend?: string; instant?: boolean }>,
  defaults: Record<string, unknown> = {},
  extra: Panel = {},
): Panel {
  return {
    type,
    title,
    gridPos,
    datasource: PROM,
    targets: targets.map((t, i) => ({
      refId: String.fromCharCode(65 + i),
      datasource: PROM,
      expr: t.expr,
      legendFormat: t.legend ?? '__auto',
      range: !t.instant,
      instant: !!t.instant,
    })),
    fieldConfig: { defaults, overrides: [] },
    options: type === 'stat' ? { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, colorMode: 'value', graphMode: 'area' } : {},
    ...extra,
  };
}

const at = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

function panels(id: TemplateId): Panel[] {
  switch (id) {
    case 'database':
      return [
        panel('stat', 'Database pods ready', at(0, 0, 6, 4), [{ expr: `sum(kube_pod_status_ready{${NS}, ${DB_POD}, condition="true"})` }], { noValue: '0' }),
        panel('stat', 'Restarts (24 h)', at(6, 0, 6, 4), [{ expr: `sum(increase(kube_pod_container_status_restarts_total{${NS}, ${DB_POD}}[24h]))` }], {
          noValue: '0',
          thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'orange', value: 1 }, { color: 'red', value: 5 }] },
          color: { mode: 'thresholds' },
        }),
        panel('stat', 'Most used volume', at(12, 0, 6, 4), [{ expr: `max(100 * kubelet_volume_stats_used_bytes{${NS}, ${DB_PVC}} / kubelet_volume_stats_capacity_bytes{${NS}, ${DB_PVC}})` }], {
          unit: 'percent',
          thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'orange', value: 75 }, { color: 'red', value: 90 }] },
          color: { mode: 'thresholds' },
        }),
        panel('stat', 'OOM kills (24 h)', at(18, 0, 6, 4), [{ expr: `sum(increase(container_oom_events_total{${NS}, ${DB_POD}}[24h]))` }], { noValue: '0' }),
        panel('timeseries', 'CPU by pod', at(0, 4, 12, 8), [{ expr: `sum by (pod) (rate(container_cpu_usage_seconds_total{${NS}, ${DB_POD}, container!=""}[$__rate_interval]))`, legend: '{{pod}}' }], { unit: 'cores' }),
        panel('timeseries', 'Memory by pod', at(12, 4, 12, 8), [
          { expr: `sum by (pod) (container_memory_working_set_bytes{${NS}, ${DB_POD}, container!=""})`, legend: '{{pod}}' },
          { expr: `sum by (pod) (kube_pod_container_resource_limits{${NS}, ${DB_POD}, resource="memory"})`, legend: 'limit {{pod}}' },
        ], { unit: 'bytes' }),
        panel('timeseries', 'Volume used', at(0, 12, 12, 8), [{ expr: `kubelet_volume_stats_used_bytes{${NS}, ${DB_PVC}}`, legend: '{{persistentvolumeclaim}}' }, { expr: `kubelet_volume_stats_capacity_bytes{${NS}, ${DB_PVC}}`, legend: 'capacity {{persistentvolumeclaim}}' }], { unit: 'bytes' }),
        panel('timeseries', 'Disk writes', at(12, 12, 12, 8), [{ expr: `sum by (pod) (rate(container_fs_writes_bytes_total{${NS}, ${DB_POD}}[$__rate_interval]))`, legend: '{{pod}}' }], { unit: 'Bps' }),
      ];
    case 'jobs':
      return [
        panel('table', 'Hours since the last success', at(0, 0, 12, 8), [{ expr: `(time() - kube_cronjob_status_last_successful_time{${NS}}) / 3600`, legend: '{{cronjob}}', instant: true }], {
          unit: 'h',
          decimals: 1,
          thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'orange', value: 24 }, { color: 'red', value: 72 }] },
          custom: { cellOptions: { type: 'color-text' } },
        }, { transformations: [{ id: 'labelsToFields', options: { mode: 'columns' } }, { id: 'organize', options: { includeByName: { cronjob: true, Value: true }, renameByName: { cronjob: 'CronJob', Value: 'Hours' } } }] }),
        panel('stat', 'Failed jobs now', at(12, 0, 6, 4), [{ expr: `sum(kube_job_status_failed{${NS}} > 0) or vector(0)` }], {
          thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'red', value: 1 }] },
          color: { mode: 'thresholds' },
        }),
        panel('stat', 'Running jobs', at(18, 0, 6, 4), [{ expr: `sum(kube_job_status_active{${NS}}) or vector(0)` }]),
        panel('timeseries', 'Jobs by result', at(12, 4, 12, 8), [
          { expr: `sum(kube_job_status_succeeded{${NS}})`, legend: 'succeeded' },
          { expr: `sum(kube_job_status_failed{${NS}})`, legend: 'failed' },
        ]),
      ];
    case 'platform':
      return [
        panel('timeseries', 'Calls by block and outcome', at(0, 0, 12, 8), [{ expr: `sum by (block, outcome) (rate(platform_calls_total{${NS}}[$__rate_interval]))`, legend: '{{block}} {{outcome}}' }], { unit: 'reqps' }),
        panel('timeseries', 'Errors by block (%)', at(12, 0, 12, 8), [
          { expr: `100 * sum by (block) (rate(platform_calls_total{${NS}, outcome!="ok"}[$__rate_interval])) / clamp_min(sum by (block) (rate(platform_calls_total{${NS}}[$__rate_interval])), 1e-9)`, legend: '{{block}}' },
        ], { unit: 'percent' }),
        panel('timeseries', 'Latency p95 by operation', at(0, 8, 24, 8), [
          { expr: `histogram_quantile(0.95, sum by (le, block, operation) (rate(platform_call_duration_seconds_bucket{${NS}}[$__rate_interval])))`, legend: '{{block}} {{operation}}' },
        ], { unit: 's' }),
      ];
    case 'business':
      return [
        {
          type: 'row',
          title: '$metric',
          gridPos: at(0, 0, 24, 1),
          collapsed: false,
          repeat: 'metric',
          panels: [],
        },
        panel('timeseries', '$metric', at(0, 1, 12, 8), [{ expr: `sum({__name__="$metric", ${NS}})`, legend: 'value' }]),
        panel('timeseries', '$metric per second (counters)', at(12, 1, 12, 8), [{ expr: `sum(rate({__name__="$metric", ${NS}}[$__rate_interval]))`, legend: 'per second' }]),
      ];
    default:
      return [];
  }
}

/** Metrics of every application (the frameworks, the runtime, Kubernetes): not "business" ones. */
const STANDARD =
  '/^(?!(http_|python_|process_|container_|kube_|kubelet_|jvm_|platform_|scrape_|up$|namespace_|pod_|deployment_|service_|statefulSet_|executor_|hikaricp_|jdbc_|logback_|system_|tomcat_|application_|disk_|spring_|lettuce_|tasks_|cache_)).*/';

/** The dashboard of a template, as the file platform/monitoring/<name>.json of the application. */
export function templateDashboard(id: TemplateId): Record<string, unknown> {
  const t = TEMPLATES.find(x => x.id === id)!;
  const variables: Array<Record<string, unknown>> = [
    { name: 'prometheus', label: 'Prometheus', type: 'datasource', query: 'prometheus', current: {}, hide: 2 },
    { name: 'namespace', type: 'constant', query: '', hide: 2 },
  ];
  if (id === 'business') {
    variables.push({
      name: 'metric',
      label: 'Metric',
      type: 'query',
      datasource: PROM,
      query: { query: 'label_values({namespace="$namespace"}, __name__)', refId: 'metric' },
      regex: STANDARD,
      refresh: 2,
      multi: true,
      includeAll: true,
      current: { text: 'All', value: '$__all' },
      sort: 1,
    });
  }
  return {
    title: t.title,
    description: `${t.description} Template "${t.id}" of Manage › Monitoring (Refresquito console).`,
    tags: [`template:${t.id}`],
    editable: true,
    graphTooltip: 1,
    refresh: '1m',
    schemaVersion: 39,
    time: { from: 'now-6h', to: 'now' },
    timezone: 'browser',
    annotations: { list: [] },
    links: [],
    templating: { list: variables },
    panels: panels(id).map((p, i) => ({ id: i + 1, ...p })),
  };
}

/**
 * A dashboard exported from Grafana (Share › Export, or the JSON model), as the file of the application: the export
 * "with the dashboard inside" is unwrapped, and what the provisioner sets (id, uid, version) or Grafana keeps per
 * instance (__inputs, __requires, iteration) is dropped. Throws a message when it is not a dashboard.
 */
export function importedDashboard(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`it is not JSON (${(e as Error).message})`);
  }
  const outer = parsed as Record<string, unknown> | null;
  const d = (outer && typeof outer === 'object' && outer.dashboard && typeof outer.dashboard === 'object' ? outer.dashboard : outer) as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.panels)) throw new Error('it is not a Grafana dashboard (no panels)');
  const { id: _id, uid: _uid, version: _version, iteration: _iteration, __inputs: inputs, __requires: _requires, __elements: _elements, refresquito: _r, ...rest } = d;
  // an export "for sharing externally" names its datasources ${DS_<NAME>} (its __inputs): they become the datasource
  // variables of the platform's dashboards, ${prometheus} and ${loki}
  let json = JSON.stringify(rest);
  const used = new Set<string>();
  for (const input of Array.isArray(inputs) ? (inputs as Array<Record<string, unknown>>) : []) {
    const plugin = ['loki', 'prometheus'].includes(String(input.pluginId)) ? String(input.pluginId) : undefined;
    if (typeof input.name !== 'string' || !plugin) continue;
    json = json.split(`\${${input.name}}`).join(`\${${plugin}}`);
    used.add(plugin);
  }
  const out = JSON.parse(json) as Record<string, unknown>;
  const templating = (out.templating && typeof out.templating === 'object' ? out.templating : { list: [] }) as { list?: Array<Record<string, unknown>> };
  const list = Array.isArray(templating.list) ? templating.list : [];
  for (const plugin of used) {
    if (!list.some(v => v.name === plugin)) list.unshift({ name: plugin, label: plugin === 'loki' ? 'Loki' : 'Prometheus', type: 'datasource', query: plugin, current: {}, hide: 2 });
  }
  out.templating = { ...templating, list };
  return out;
}
