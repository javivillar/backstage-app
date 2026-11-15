import { appView, backupOf, bytesOf, graceHours, planChange, ProtectionError, protectionView, pvcOf, readDeclared, readPlanChanges, snapshotOf, usageOf, withPlans } from './protectionModel';

const NOW = new Date('2026-11-15T12:00:00Z');
const PLANS = {
  critical: { snapshot: { cron: '0 */6 * * *', retain: 8 }, backup: { cron: '0 2 * * *', ttl: '336h' }, weekly: { cron: '0 4 * * 0', ttl: '1344h' }, volumes: true },
  rebuild: { backup: { cron: '30 3 * * 0', ttl: '672h' }, volumes: false },
};
const pvc = (namespace: string, name: string, gi = 4) => ({ namespace, name, volume: `pvc-${name}`, bytes: gi * 2 ** 30, storageClass: 'longhorn-retain' });
const snap = (name: string, created: string, bytes = 2 ** 20) => ({ volume: `pvc-${name}`, created, bytes, ready: true });
const backup = (name: string, ns: string, phase: string, completed: string, bytes = 0) => ({ name, namespaces: [ns], phase, started: completed, completed, errors: 0, warnings: 0, bytes, withVolumes: true });

const VALUES = `# the plans
plans:
  critical:
    title: Critical data
  standard:
    title: Standard
# The plan of each application
apps:
  iam-oneke: { plan: critical }
  gravitee-oneke: { plan: standard }   # the gateway
  observability-oneke: { plan: none }
`;

describe('the state of an application', () => {
  const app = { plan: 'critical', namespace: 'p-iam-oneke' };
  it('is protected with a backup of last night, and adds up its volumes and snapshots', () => {
    const v = appView('iam-oneke', app, 'p-iam-oneke', PLANS, [pvc('p-iam-oneke', 'db'), pvc('p-other', 'x')],
      [snap('db', '2026-11-15T06:00:00Z', 100), snap('db', '2026-11-15T00:00:00Z', 50), snap('x', '2026-11-15T06:00:00Z')],
      [backup('b1', 'p-iam-oneke', 'Completed', '2026-11-15T02:04:00Z', 900), backup('b0', 'p-iam-oneke', 'Completed', '2026-11-14T02:04:00Z', 800), backup('o', 'p-other', 'Completed', '2026-11-15T02:00:00Z')], NOW);
    expect(v.state).toBe('ok');
    expect(v.volumes).toHaveLength(1);
    expect(v.volumes[0]).toMatchObject({ name: 'db', snapshots: 2, snapshotBytes: 150, lastSnapshot: '2026-11-15T06:00:00Z' });
    expect(v).toMatchObject({ lastBackup: '2026-11-15T02:04:00Z', backupBytes: 900, snapshotBytes: 150, volumeBytes: 4 * 2 ** 30 });
    expect(v.backups.map(b => b.name)).toEqual(['b1', 'b0']);
    expect(v.snapshotTimes).toEqual(['2026-11-15T06:00:00Z', '2026-11-15T00:00:00Z']);
  });
  it('is late when the last good backup is older than a day and two hours', () => {
    const v = appView('iam-oneke', app, 'p-iam-oneke', PLANS, [pvc('p-iam-oneke', 'db')], [], [backup('b', 'p-iam-oneke', 'Completed', '2026-11-12T02:00:00Z'), backup('f', 'p-iam-oneke', 'Failed', '2026-11-15T02:00:00Z')], NOW);
    expect(v.state).toBe('late');
    expect(v.lateHours).toBe(82);
  });
  it('says a failed last backup, no backup yet, no plan and the application that holds the store', () => {
    const vols = [pvc('p-iam-oneke', 'db')];
    expect(appView('a', app, 'p-iam-oneke', PLANS, vols, [], [backup('ok', 'p-iam-oneke', 'Completed', '2026-11-14T12:00:00Z'), backup('f', 'p-iam-oneke', 'PartiallyFailed', '2026-11-15T02:00:00Z')], NOW).state).toBe('failed');
    expect(appView('a', app, 'p-iam-oneke', PLANS, vols, [], [], NOW).state).toBe('never');
    expect(appView('a', app, 'p-iam-oneke', PLANS, vols, [], [backup('f', 'p-iam-oneke', 'Failed', '2026-11-15T02:00:00Z')], NOW).state).toBe('failed');
    expect(appView('a', { plan: 'none', namespace: 'p-iam-oneke' }, 'p-iam-oneke', PLANS, vols, [], [], NOW).state).toBe('noplan');
    expect(appView('a', { plan: 'gone', namespace: 'p-iam-oneke' }, 'p-iam-oneke', PLANS, vols, [], [], NOW)).toMatchObject({ state: 'noplan', plan: 'none' });
    expect(appView('a', { ...app, holdsStore: true }, 'p-iam-oneke', PLANS, vols, [], [], NOW).state).toBe('store');
  });
  it('gives a weekly plan eight days', () => {
    expect(graceHours('0 2 * * *')).toBe(26);
    expect(graceHours('30 3 * * 0')).toBe(192);
    const v = appView('w', { plan: 'rebuild', namespace: 'p-w' }, 'p-w', PLANS, [pvc('p-w', 'idx')], [], [backup('b', 'p-w', 'Completed', '2026-11-09T03:30:00Z')], NOW);
    expect(v.state).toBe('ok');
  });
});

describe('every application', () => {
  const declared = { store: { kind: 'seaweedfs', url: 'http://s', bucket: 'velero', inCluster: true }, plans: PLANS, apps: { 'iam-oneke': { plan: 'critical', namespace: 'p-iam-oneke' }, 'absent-oneke': { plan: 'critical', namespace: 'p-absent-oneke' } } };
  it('lists the declared ones that are installed and every other namespace of the cluster with volumes as no plan', () => {
    const views = protectionView(declared, 'p-', [pvc('p-iam-oneke', 'db'), pvc('p-loose-oneke', 'data'), pvc('kube-system', 'x')], [snap('data', '2026-11-15T00:00:00Z', 7)], [backup('b', 'p-iam-oneke', 'Completed', '2026-11-15T02:00:00Z', 5)], NOW);
    expect(views.map(v => [v.app, v.state])).toEqual([['iam-oneke', 'ok'], ['loose-oneke', 'noplan']]);
    expect(usageOf(views)).toEqual({ 'p-iam-oneke': { snapshotBytes: 0, backupBytes: 5, plan: 'critical' }, 'p-loose-oneke': { snapshotBytes: 7, backupBytes: 0, plan: 'none' } });
  });
});

describe('Kubernetes objects', () => {
  it('reads quantities, volumes, snapshots and backups', () => {
    expect(bytesOf('8Gi')).toBe(8 * 2 ** 30);
    expect(bytesOf('500M')).toBe(5e8);
    expect(bytesOf(undefined)).toBe(0);
    expect(pvcOf({ metadata: { namespace: 'n', name: 'db' }, spec: { volumeName: 'pvc-1', storageClassName: 'longhorn', resources: { requests: { storage: '4Gi' } } }, status: { capacity: { storage: '5Gi' } } }))
      .toEqual({ namespace: 'n', name: 'db', volume: 'pvc-1', bytes: 5 * 2 ** 30, storageClass: 'longhorn' });
    expect(snapshotOf({ metadata: { name: 'volume-head' }, spec: { volume: 'pvc-1' } })).toBeUndefined();
    expect(snapshotOf({ metadata: { name: 's' }, spec: { volume: 'pvc-1' }, status: { creationTime: '2026-11-15T06:00:00Z', size: '1048576', readyToUse: true } }))
      .toEqual({ volume: 'pvc-1', created: '2026-11-15T06:00:00Z', bytes: 1048576, ready: true });
    const b = backupOf({ metadata: { name: 'iam-1', labels: { 'velero.io/schedule-name': 'iam-oneke' } }, spec: { includedNamespaces: ['p-iam-oneke'], storageLocation: 'default' }, status: { phase: 'Completed', completionTimestamp: 't', errors: 0 } },
      [{ metadata: { labels: { 'velero.io/backup-name': 'iam-1' } }, status: { progress: { totalBytes: 300 } } }, { metadata: { labels: { 'velero.io/backup-name': 'other' } }, status: { progress: { totalBytes: 9 } } }]);
    expect(b).toMatchObject({ name: 'iam-1', schedule: 'iam-oneke', phase: 'Completed', bytes: 300, withVolumes: true });
  });
  it('reads what the chart declares and refuses anything else', () => {
    expect(readDeclared('{"store":{"kind":"s3"},"plans":{},"apps":{}}').store.kind).toBe('s3');
    expect(() => readDeclared('nope')).toThrow(ProtectionError);
    expect(() => readDeclared('{"plans":{}}')).toThrow(ProtectionError);
  });
});

describe('changing plans', () => {
  it('reads the changes of a request', () => {
    expect(readPlanChanges({ 'iam-oneke': 'standard' })).toEqual({ 'iam-oneke': 'standard' });
    expect(() => readPlanChanges({})).toThrow(ProtectionError);
    expect(() => readPlanChanges({ 'Bad Name': 'standard' })).toThrow(ProtectionError);
    expect(() => readPlanChanges({ 'iam-oneke': 3 })).toThrow(ProtectionError);
  });
  it('changes the plans in values.yaml and keeps its comments', () => {
    const { text, changed } = withPlans(VALUES, { 'observability-oneke': 'standard', 'iam-oneke': 'critical', 'new-oneke': 'critical' });
    expect(changed).toEqual([{ app: 'observability-oneke', from: 'none', to: 'standard' }, { app: 'new-oneke', from: 'none', to: 'critical' }]);
    expect(text).toContain('observability-oneke: { plan: standard }');
    expect(text).toContain('new-oneke: { plan: critical }');
    expect(text).toContain('gravitee-oneke: { plan: standard } # the gateway');
    expect(text).toContain('# The plan of each application');
  });
  it('refuses a plan the chart does not have, and a change that changes nothing', () => {
    expect(() => withPlans(VALUES, { 'iam-oneke': 'gold' })).toThrow(/not a plan/);
    expect(() => withPlans(VALUES, { 'iam-oneke': 'critical' })).toThrow(/Nothing changes/);
  });
  it('writes the five files of the pull request', () => {
    const files = {
      values: VALUES,
      chart: 'name: protection-oneke\nversion: 0.1.0\n',
      changelog: '# Release notes\n\n## 0.1.0 - 2026-11-15\n\n- First version.\n',
      overview: '| Chart | `charts/protection-oneke`, version 0.1.0 |\n\n## Latest release\n\n**0.1.0 - 2026-11-15**\n\n- First version.\n\nEvery version: [Release notes](changelog.md)\n',
      versions: '"protection-oneke": "0.1.0"\n',
    };
    const c = planChange(files, { 'observability-oneke': 'standard' }, { chart: 'protection-oneke', by: 'user:default/ana', date: '2026-11-16' });
    expect(c.next).toBe('0.1.1');
    expect(c.title).toBe('protection-oneke 0.1.1: plan of observability-oneke');
    expect(c.files.map(f => f.path)).toEqual(['charts/protection-oneke/values.yaml', 'charts/protection-oneke/Chart.yaml', 'charts/protection-oneke/CHANGELOG.md', 'charts/protection-oneke/docs/index.md', 'bootstrap/app-of-apps/files/chart-versions.yaml']);
    expect(c.files[2].text).toContain('## 0.1.1 - 2026-11-16\n\n- **Protection plans** changed from the console');
    expect(c.files[2].text).toContain('  - `observability-oneke`: none → standard');
    expect(c.files[4].text).toBe('"protection-oneke": "0.1.1"\n');
  });
});
