import { configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { MockConfigApi, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { DataContinuityPage, EntityProtectionContent, ProtectionAppPage, ProtectionPlansPage, ProtectionStorePage } from './Protection';

const GIB = 2 ** 30;
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const app = (name: string, plan: string, state: string, more: object = {}) => ({
  app: name, namespace: `p-${name}`, plan, holdsStore: false, state,
  volumes: [{ name: 'db', volume: 'pvc-1', bytes: 4 * GIB, storageClass: 'longhorn-retain', snapshots: 2, snapshotBytes: GIB, lastSnapshot: ago(2) }],
  volumeBytes: 4 * GIB, snapshotBytes: GIB, lastSnapshot: ago(2), snapshotTimes: [ago(2), ago(8)], lastBackup: ago(10), backupBytes: 2 * GIB,
  backups: [{ name: `${name}-1`, schedule: name, phase: 'Completed', started: ago(10), completed: ago(10), expires: ago(-300), errors: 0, warnings: 0, bytes: 2 * GIB, withVolumes: true }],
  ...more,
});
const body = (more: object = {}) => ({
  available: true,
  store: { kind: 'seaweedfs', url: 'http://seaweedfs:8333', bucket: 'velero-nato-sirtap', inCluster: true, phase: 'Available', validated: ago(1) },
  plans: {
    critical: { title: 'Critical data', description: 'Databases', snapshot: { cron: '0 */6 * * *', retain: 8 }, backup: { cron: '0 2 * * *', ttl: '336h' }, weekly: { cron: '0 4 * * 0', ttl: '1344h' }, volumes: true },
    standard: { title: 'Standard', snapshot: { cron: '30 0 * * *', retain: 7 }, backup: { cron: '30 2 * * *', ttl: '168h' }, volumes: true },
  },
  apps: [
    app('petstore-oneke', 'critical', 'ok'),
    app('alfrescodms-oneke', 'critical', 'late', { lateHours: 82 }),
    app('seaweedfs-oneke', 'standard', 'store', { holdsStore: true, backups: [], lastBackup: undefined, backupBytes: 0 }),
    app('observability-oneke', 'none', 'noplan', { backups: [], lastBackup: undefined, backupBytes: 0, snapshotBytes: 0, snapshotTimes: [] }),
  ],
  may: true, groups: ['backstage-admin'], repo: 'o/services', path: 'charts/protection-oneke/values.yaml', url: 'https://github.com/o/services/blob/main/charts/protection-oneke/values.yaml',
  ...more,
});
let answer: { status: number; body: unknown };
const posts: unknown[] = [];
const fetchFake = async (url: RequestInfo | URL, init?: RequestInit) => {
  if (init?.method === 'POST') {
    posts.push(JSON.parse(String(init.body)));
    return new Response('{"pull":{"number":21,"url":"https://github.com/o/services/pull/21"},"version":"0.1.1","changed":[]}');
  }
  if (!String(url).endsWith('/api/protection')) return new Response('{}', { status: 404 });
  return new Response(JSON.stringify(answer.body), { status: answer.status });
};
const show = (element: ReactElement, at = '/') =>
  renderInTestApp(
    <TestApiProvider
      apis={[
        [configApiRef, new MockConfigApi({ opencost: { currency: 'EUR', pricing: { protection: { snapshotPerGiBMonth: 0.05, backupPerGiBMonth: 0.02 } } } })],
        [discoveryApiRef, { getBaseUrl: async (id: string) => `http://b/api/${id}` }],
        [fetchApiRef, { fetch: fetchFake }],
      ]}
    >
      <Routes>
        <Route path="/app/:app" element={element} />
        <Route path="*" element={element} />
      </Routes>
    </TestApiProvider>,
    { routeEntries: [at] },
  );
const section = (name: string | RegExp) => screen.getByRole('heading', { name }).closest('section') as HTMLElement;

beforeEach(() => {
  posts.length = 0;
  answer = { status: 200, body: body() };
});

describe('Data continuity', () => {
  it('lists every application with its plan, its last copies and its state, and warns of the store inside the cluster', async () => {
    await show(<DataContinuityPage />);
    const list = await waitFor(() => section('Applications and their data'));
    expect(within(list).getAllByRole('row')).toHaveLength(5);
    expect(within(list).getByText('Backup late')).toBeInTheDocument();
    expect(within(list).getByText('The last backup that completed is 82 hours old.')).toBeInTheDocument();
    expect(within(list).getByText('Waits for the outside store')).toBeInTheDocument();
    expect(within(list).getAllByText('No plan').length).toBeGreaterThan(0);
    // 1 GiB of snapshots at 0.05 and 2 GiB protected at 0.02
    expect(within(list).getAllByText(/0[.,]09/).length).toBeGreaterThan(0);
    expect(screen.getByText('The backup store is inside the cluster.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Need attention/ }));
    expect(within(section('Applications and their data')).getAllByRole('row')).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Search an application or a plan'), { target: { value: 'alfresco' } });
    expect(within(section('Applications and their data')).getAllByRole('row')).toHaveLength(2);
  });

  it('says so when protection-oneke is not installed, and when the backend fails', async () => {
    answer = { status: 200, body: { available: false, reason: 'protection-oneke is not installed in this cluster.', apps: [], plans: {} } };
    const first = await show(<DataContinuityPage />);
    expect(await screen.findByText('Data continuity is not available in this cluster')).toBeInTheDocument();
    expect(screen.getByText('protection-oneke is not installed in this cluster.')).toBeInTheDocument();
    first.unmount();
    answer = { status: 502, body: { error: 'the cluster did not answer' } };
    await show(<DataContinuityPage />);
    expect(await screen.findByText('the cluster did not answer')).toBeInTheDocument();
  });

  it('shows one application: plan, recovery points, volumes and backups', async () => {
    await show(<ProtectionAppPage />, '/app/petstore-oneke');
    const protection = await waitFor(() => section('Protection'));
    expect(within(protection).getByText('Every 6 hours · the last 8')).toBeInTheDocument();
    expect(within(protection).getByText('Every day at 02:00 UTC · kept 14 days')).toBeInTheDocument();
    expect(within(protection).getByText('Every Sunday at 04:00 UTC · kept 56 days')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Snapshots: 2 in 7 days' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Backups: 1 in 7 days' })).toBeInTheDocument();
    expect(within(section('Volumes')).getByText('db')).toBeInTheDocument();
    expect(within(section('Last backups')).getByText('Completed')).toBeInTheDocument();
  });

  it('changes the plan of an application with a pull request', async () => {
    await show(<ProtectionPlansPage />);
    const select = await screen.findByLabelText('Plan of observability-oneke');
    expect(screen.queryByRole('button', { name: 'Open the pull request' })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'standard' } });
    expect(screen.getByRole('status')).toHaveTextContent('1 changed');
    fireEvent.click(screen.getByRole('button', { name: 'Open the pull request' }));
    await waitFor(() => expect(posts).toEqual([{ changes: { 'observability-oneke': 'standard' } }]));
    expect(await screen.findByText(/Pull request #21 opened: protection-oneke 0.1.1/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /See it on GitHub/ })).toHaveAttribute('href', 'https://github.com/o/services/pull/21');
  });

  it('does not let who may not change plans', async () => {
    answer = { status: 200, body: body({ may: false }) };
    await show(<ProtectionPlansPage />);
    expect(await screen.findByLabelText('Plan of petstore-oneke')).toBeDisabled();
    expect(screen.getByText('Only backstage-admin may change the plans.')).toBeInTheDocument();
  });

  it('says what the store covers inside the cluster and outside', async () => {
    const first = await show(<ProtectionStorePage />);
    expect(await screen.findByText('SeaweedFS of this cluster')).toBeInTheDocument();
    expect(within(section('What it protects against')).getAllByText('Lost with the disk')).toHaveLength(5);
    expect(screen.getByRole('heading', { name: 'Moving the store outside the cluster' })).toBeInTheDocument();
    first.unmount();
    answer = { status: 200, body: body({ store: { kind: 's3', url: 'https://backups.example:8333', bucket: 'velero', inCluster: false, phase: 'Available' } }) };
    await show(<ProtectionStorePage />);
    expect(await screen.findByText('S3 store outside the cluster')).toBeInTheDocument();
    expect(within(section('What it protects against')).getAllByText('Lost with the disk')).toHaveLength(3);
    expect(screen.queryByRole('heading', { name: 'Moving the store outside the cluster' })).not.toBeInTheDocument();
  });

  it('shows, in the tab of an application, its own data and the shared services that keep its data', async () => {
    const entity = {
      apiVersion: 'backstage.io/v1alpha1', kind: 'Component', metadata: { name: 'petstore-oneke', annotations: { 'backstage.io/kubernetes-namespace': 'p-petstore-oneke' } },
      relations: [{ type: 'dependsOn', targetRef: 'component:default/alfrescodms-oneke' }, { type: 'dependsOn', targetRef: 'component:default/seaweedfs-oneke' }, { type: 'dependsOn', targetRef: 'component:default/iam-oneke' }],
    };
    await show(<EntityProvider entity={entity}><EntityProtectionContent /></EntityProvider>);
    const shared = await waitFor(() => section('Data of this application kept by other services'));
    expect(within(shared).getAllByRole('row')).toHaveLength(3);
    expect(within(shared).getByText('0 of 2 protected')).toBeInTheDocument();
    expect(screen.getByText(/2 of the 2 services that keep data of this application need attention: alfrescodms-oneke, seaweedfs-oneke/)).toBeInTheDocument();
    expect(within(section('Volumes')).getByText('db')).toBeInTheDocument();
  });
});
