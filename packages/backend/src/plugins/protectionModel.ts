/**
 * Data continuity of the applications (console: Portal › Business management › Data continuity, and the tab
 * Data continuity of an application): what the chart protection-oneke declares (plans, the plan of each
 * application, the backup store) put together with what the cluster holds (volumes, Longhorn snapshots, Velero
 * backups). Pure functions: the plugin (protection.ts) reads the cluster and the repository.
 *
 * Snapshots are taken by Longhorn and live on the disk of the volume; backups are taken by Velero and live in the
 * backup store. The size of a backup is what its data mover read (the data protected), not what the store keeps:
 * Velero does not report the space of each application in the store.
 */
import { parseDocument } from 'yaml';
import { nextVersion, pricePaths, PriceError, PriceFiles, withChangelog, withChartVersion, withOverview } from './costPrices';

export class ProtectionError extends PriceError {}

export type Plan = {
  title?: string;
  description?: string;
  snapshot?: { cron: string; retain: number };
  backup?: { cron: string; ttl: string };
  weekly?: { cron: string; ttl: string };
  volumes?: boolean;
};
export type Declared = {
  store: { kind: string; url: string; bucket: string; region?: string; inCluster: boolean; next?: { url?: string; bucket?: string } };
  plans: Record<string, Plan>;
  apps: Record<string, { plan: string; namespace: string; holdsStore?: boolean }>;
};

export type Pvc = { namespace: string; name: string; volume?: string; bytes: number; storageClass?: string };
export type Snapshot = { volume: string; created?: string; bytes: number; ready: boolean };
export type Backup = {
  name: string;
  namespaces: string[];
  schedule?: string;
  location?: string;
  phase: string;
  started?: string;
  completed?: string;
  expires?: string;
  errors: number;
  warnings: number;
  /** what its data uploads read: the data protected */
  bytes: number;
  withVolumes: boolean;
};

export type AppState = 'ok' | 'late' | 'failed' | 'never' | 'noplan' | 'store';
export type VolumeView = { name: string; volume?: string; bytes: number; storageClass?: string; snapshots: number; snapshotBytes: number; lastSnapshot?: string };
export type AppView = {
  app: string;
  namespace: string;
  plan: string;
  holdsStore: boolean;
  state: AppState;
  /** hours since the last backup that completed, when the state is late */
  lateHours?: number;
  volumes: VolumeView[];
  volumeBytes: number;
  snapshotBytes: number;
  lastSnapshot?: string;
  /** when its snapshots were taken, newest first (the last 60 moments) */
  snapshotTimes: string[];
  lastBackup?: string;
  /** the data protected by the last backup that completed */
  backupBytes: number;
  backups: Backup[];
};

const OK = new Set(['Completed']);
const FAILED = new Set(['Failed', 'PartiallyFailed', 'FailedValidation']);

/** hours a backup of this schedule may be old before it is late: a day and two hours, or eight days when it is weekly */
export function graceHours(cron: string | undefined): number {
  const dow = (cron ?? '').trim().split(/\s+/)[4];
  return dow && dow !== '*' ? 8 * 24 : 26;
}

const newest = (dates: Array<string | undefined>) => dates.filter((d): d is string => Boolean(d)).sort().pop();

/** One application: its volumes with their snapshots, its backups (newest first) and whether it is protected. */
export function appView(
  app: string,
  declared: { plan: string; namespace: string; holdsStore?: boolean } | undefined,
  namespace: string,
  plans: Record<string, Plan>,
  pvcs: Pvc[],
  snapshots: Snapshot[],
  backups: Backup[],
  now = new Date(),
): AppView {
  const plan = declared?.plan ?? 'none';
  const p = plans[plan];
  const byVolume = new Map<string, Snapshot[]>();
  for (const s of snapshots) if (s.ready) byVolume.set(s.volume, [...(byVolume.get(s.volume) ?? []), s]);
  const volumes = pvcs
    .filter(v => v.namespace === namespace)
    .map(v => {
      const own = (v.volume && byVolume.get(v.volume)) || [];
      return {
        name: v.name,
        volume: v.volume,
        bytes: v.bytes,
        storageClass: v.storageClass,
        snapshots: own.length,
        snapshotBytes: own.reduce((s, x) => s + x.bytes, 0),
        lastSnapshot: newest(own.map(x => x.created)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const mine = backups.filter(b => b.namespaces.includes(namespace)).sort((a, b) => (b.started ?? '').localeCompare(a.started ?? ''));
  const done = mine.filter(b => OK.has(b.phase));
  const last = done[0];
  const holdsStore = Boolean(declared?.holdsStore);
  let state: AppState = 'ok';
  let lateHours: number | undefined;
  if (!p || plan === 'none') state = 'noplan';
  else if (holdsStore) state = 'store';
  else if (!last) state = mine.some(b => FAILED.has(b.phase)) ? 'failed' : 'never';
  else {
    const hours = (now.getTime() - new Date(last.completed ?? last.started ?? 0).getTime()) / 3_600_000;
    if (hours > graceHours(p.backup?.cron)) {
      state = 'late';
      lateHours = Math.round(hours);
    } else if (mine[0] && FAILED.has(mine[0].phase)) state = 'failed';
  }
  return {
    app,
    namespace,
    plan: p ? plan : 'none',
    holdsStore,
    state,
    lateHours,
    volumes,
    volumeBytes: volumes.reduce((s, v) => s + v.bytes, 0),
    snapshotBytes: volumes.reduce((s, v) => s + v.snapshotBytes, 0),
    lastSnapshot: newest(volumes.map(v => v.lastSnapshot)),
    snapshotTimes: [...new Set(volumes.flatMap(v => ((v.volume && byVolume.get(v.volume)) || []).map(x => x.created ?? '')))].filter(Boolean).sort().reverse().slice(0, 60),
    lastBackup: last?.completed ?? last?.started,
    backupBytes: last?.bytes ?? 0,
    backups: mine.slice(0, 20),
  };
}

/**
 * Every application: the ones the chart declares, and every other namespace of the cluster (those that start with
 * the prefix) that has volumes, as "no plan".
 */
export function protectionView(declared: Declared, prefix: string, pvcs: Pvc[], snapshots: Snapshot[], backups: Backup[], now = new Date()): AppView[] {
  const views: AppView[] = [];
  const seen = new Set<string>();
  for (const [app, a] of Object.entries(declared.apps)) {
    seen.add(a.namespace);
    // an application of the list that is not installed here (no volumes, no backups) is not shown
    const view = appView(app, a, a.namespace, declared.plans, pvcs, snapshots, backups, now);
    if (view.volumes.length || view.backups.length) views.push(view);
  }
  for (const ns of [...new Set(pvcs.map(v => v.namespace))].sort()) {
    if (seen.has(ns) || (prefix && !ns.startsWith(prefix))) continue;
    views.push(appView(prefix ? ns.slice(prefix.length) : ns, undefined, ns, declared.plans, pvcs, snapshots, backups, now));
  }
  return views.sort((a, b) => a.app.localeCompare(b.app));
}

/** Per namespace, what is charged: the space of its snapshots and the data its last backup protects. */
export const usageOf = (views: AppView[]) =>
  Object.fromEntries(views.map(v => [v.namespace, { snapshotBytes: v.snapshotBytes, backupBytes: v.backupBytes, plan: v.plan }]));

// ---- Kubernetes objects to the shapes above ----------------------------------------------------------------------

const QUANTITY: Record<string, number> = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, K: 1e3, M: 1e6, G: 1e9, T: 1e12, k: 1e3 };
export function bytesOf(quantity: unknown): number {
  const m = /^([0-9.]+)\s*([A-Za-z]*)$/.exec(String(quantity ?? '').trim());
  if (!m) return 0;
  return Math.round(Number(m[1]) * (QUANTITY[m[2]] ?? 1));
}

export const pvcOf = (o: any): Pvc => ({
  namespace: o?.metadata?.namespace ?? '',
  name: o?.metadata?.name ?? '',
  volume: o?.spec?.volumeName || undefined,
  bytes: bytesOf(o?.status?.capacity?.storage ?? o?.spec?.resources?.requests?.storage),
  storageClass: o?.spec?.storageClassName || undefined,
});

/** a Longhorn Snapshot (longhorn.io/v1beta2); the volume-head (the live data) is not a snapshot */
export const snapshotOf = (o: any): Snapshot | undefined =>
  !o?.spec?.volume || o?.metadata?.name === 'volume-head' || o?.status?.markRemoved
    ? undefined
    : { volume: o.spec.volume, created: o?.status?.creationTime || o?.metadata?.creationTimestamp, bytes: Number(o?.status?.size) || 0, ready: o?.status?.readyToUse !== false };

/** a Velero Backup with the bytes of its DataUploads (velero.io/v2alpha1, label velero.io/backup-name) */
export function backupOf(o: any, uploads: any[] = []): Backup {
  const name = o?.metadata?.name ?? '';
  const own = uploads.filter(u => u?.metadata?.labels?.['velero.io/backup-name'] === name);
  return {
    name,
    namespaces: o?.spec?.includedNamespaces ?? [],
    schedule: o?.metadata?.labels?.['velero.io/schedule-name'],
    location: o?.spec?.storageLocation,
    phase: o?.status?.phase ?? 'New',
    started: o?.status?.startTimestamp,
    completed: o?.status?.completionTimestamp,
    expires: o?.status?.expiration,
    errors: Number(o?.status?.errors) || 0,
    warnings: Number(o?.status?.warnings) || 0,
    bytes: own.reduce((s, u) => s + (Number(u?.status?.progress?.totalBytes) || 0), 0),
    withVolumes: o?.spec?.snapshotVolumes !== false,
  };
}

export function readDeclared(json: string): Declared {
  let d: any;
  try {
    d = JSON.parse(json);
  } catch {
    throw new ProtectionError('The ConfigMap protection-plans is not JSON.');
  }
  if (!d?.store || typeof d.plans !== 'object' || typeof d.apps !== 'object') throw new ProtectionError('The ConfigMap protection-plans is not as protection-oneke writes it.');
  return { store: d.store, plans: d.plans ?? {}, apps: d.apps ?? {} };
}

// ---- Changing the plan of applications: a pull request on the chart ----------------------------------------------

const APP = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function readPlanChanges(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ProtectionError('No changes.');
  const out: Record<string, string> = {};
  for (const [app, plan] of Object.entries(body as Record<string, unknown>)) {
    if (!APP.test(app)) throw new ProtectionError(`"${app}" is not the name of an application.`);
    if (typeof plan !== 'string' || !/^[a-z0-9-]{1,30}$/.test(plan)) throw new ProtectionError(`The plan of ${app} is not valid.`);
    out[app] = plan;
  }
  if (!Object.keys(out).length) throw new ProtectionError('No changes.');
  if (Object.keys(out).length > 60) throw new ProtectionError('Too many changes at once.');
  return out;
}

/** values.yaml of protection-oneke with the plans of `changes`, keeping its comments; what changed, one entry each. */
export function withPlans(valuesText: string, changes: Record<string, string>): { text: string; changed: Array<{ app: string; from: string; to: string }> } {
  const doc = parseDocument(valuesText);
  const plans = Object.keys((doc.toJS()?.plans ?? {}) as object);
  const apps = doc.get('apps') as any;
  if (!apps || typeof apps.get !== 'function') throw new ProtectionError('values.yaml of the chart has no `apps`.');
  const changed: Array<{ app: string; from: string; to: string }> = [];
  for (const [app, plan] of Object.entries(changes)) {
    if (plan !== 'none' && !plans.includes(plan)) throw new ProtectionError(`"${plan}" is not a plan of the chart (${plans.join(', ')}, none).`);
    const from = String(doc.getIn(['apps', app, 'plan']) ?? 'none');
    if (from === plan) continue;
    if (doc.hasIn(['apps', app])) doc.setIn(['apps', app, 'plan'], plan);
    else {
      const node = doc.createNode({ plan });
      (node as any).flow = true;
      doc.setIn(['apps', app], node);
    }
    changed.push({ app, from, to: plan });
  }
  if (!changed.length) throw new ProtectionError('Nothing changes: every application already has that plan.');
  return { text: doc.toString({ lineWidth: 0 }), changed };
}

/** The five files of the change, and the title and text of its pull request. */
export function planChange(files: PriceFiles, changes: Record<string, string>, opts: { chart: string; by: string; date: string }) {
  const { text: values, changed } = withPlans(files.values, changes);
  const { version, next, text: chart } = nextVersion(files.chart);
  const lines = changed.map(c => `  - \`${c.app}\`: ${c.from} → ${c.to}`);
  const entry = [`- **Protection plans** changed from the console (Data continuity › Protection plans) by ${opts.by}:`, ...lines].join('\n');
  const paths = pricePaths(opts.chart);
  return {
    version,
    next,
    changed,
    title: `${opts.chart} ${next}: ${changed.length === 1 ? `plan of ${changed[0].app}` : `the plan of ${changed.length} applications`}`,
    body: [
      `Protection plans changed from the console (Data continuity › Protection plans) by ${opts.by}.`,
      '',
      ...lines.map(l => l.slice(2)),
      '',
      `Chart \`${opts.chart}\` ${version} → ${next}. Nothing changes until this is merged and the chart is deployed: then the volumes of each application move to the snapshots of its new plan within ten minutes, and its backups follow the new schedule.`,
      'Backups and snapshots already taken are kept until they expire.',
    ].join('\n'),
    files: [
      { path: paths.values, text: values },
      { path: paths.chart, text: chart },
      { path: paths.changelog, text: withChangelog(files.changelog, next, opts.date, entry) },
      { path: paths.overview, text: withOverview(files.overview, opts.chart, next, opts.date, entry) },
      { path: paths.versions, text: withChartVersion(files.versions, opts.chart, next) },
    ],
  };
}
