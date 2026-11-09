import { configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { MockConfigApi, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ZoneStoragePage, ZoneTemplatesPage } from './ZoneInventoryPages';

const inventory = {
  vmTemplates: [
    { id: '11', name: 'Service OneKE 1.33-master', vrouter: false, vcpu: '4', memoryMb: 6144, disks: ['node 0.1.2'], networks: ['nato-sirtap-priv'], instances: ['oneke-nato-sirtap-master-0'], text: 'VCPU = "4"\nPASSWORD = "<hidden>"' },
    { id: '3', name: 'Service Virtual Router', vrouter: true, vcpu: '1', memoryMb: 512, disks: ['Service Virtual Router'], networks: [], instances: ['vr-nato-0'], text: 'VROUTER = "YES"' },
  ],
  serviceTemplates: [{ id: '2', name: 'Service OneKE 1.33', deployment: 'straight', roles: [{ name: 'master', cardinality: 1, templateId: '11' }], networks: ['Private'], instances: [{ name: 'oneke-nato-sirtap', state: '2' }], text: '{}' }],
  vmGroups: [],
  vnTemplates: [],
  images: [
    { id: '6', name: 'node 0.1.2', type: 'OS', datastore: 'default', sizeMb: 25600, persistent: false, state: 'USED', vms: ['oneke-nato-sirtap-master-0'] },
    { id: '40', name: 'backup of 27', type: 'BACKUP', datastore: 'backups', sizeMb: 900, persistent: false, state: 'READY', vms: [] },
  ],
  datastores: [{ id: '1', name: 'default', type: 'image', dsMad: 'fs', tmMad: 'qcow2', state: 'READY', totalMb: 256000, freeMb: 190000, usedMb: 66000, images: 1, clusters: ['0'] }],
  backupJobs: [{ id: '0', name: 'daily-masters', vms: ['oneke-nato-sirtap-master-0'], keepLast: '7', mode: 'INCREMENT', last: '2026-11-08T02:00:00Z', schedule: [], outdated: 0, errors: 0 }],
  vmBackups: [
    { vm: 'oneke-nato-sirtap-master-0', id: '27', job: '0', count: 1, last: '2026-11-08T02:00:00Z', persistentDisks: 0 },
    { vm: 'oneke-nato-sirtap-storage-0', id: '31', count: 0, persistentDisks: 1 },
  ],
};
const zone = {
  generated: '2026-11-09T10:00:00Z',
  warnings: [],
  drift: [],
  inventory,
  zones: [{ name: 'nato', status: 'complete', programs: [] }],
};
const fetchFake = async (url: RequestInfo | URL) => (String(url).endsWith('/zone') ? new Response(JSON.stringify(zone)) : new Response('{}', { status: 404 }));

const wrap = (children: ReactNode) =>
  renderInTestApp(
    <TestApiProvider
      apis={[
        [configApiRef, new MockConfigApi({ console: { enabled: true, cluster: { id: 'nato-sirtap', kind: 'program', zone: 'nato', program: 'sirtap' } } })],
        [discoveryApiRef, { getBaseUrl: async (id: string) => `http://b/api/${id}` }],
        [fetchApiRef, { fetch: fetchFake }],
      ]}
    >
      {children}
    </TestApiProvider>,
  );

describe('zone templates and storage', () => {
  it('lists the templates by kind and shows the definition of the one picked', async () => {
    await wrap(<ZoneTemplatesPage />);
    expect((await screen.findAllByText('Service OneKE 1.33-master')).length).toBe(2); // the row and the definition
    // the virtual router template has its own tab
    expect(screen.queryByText('Service Virtual Router')).not.toBeInTheDocument();
    expect(screen.getByText(/PASSWORD = "<hidden>"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Service templates/ }));
    expect(await screen.findByText('master ×1')).toBeInTheDocument();
    expect(screen.getAllByText('oneke-nato-sirtap (2)').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: /VM groups/ }));
    expect(await screen.findByText('No vm groups in OpenNebula.')).toBeInTheDocument();
  });

  it('shows images, datastores and the VMs without a backup', async () => {
    await wrap(<ZoneStoragePage />);
    expect(await screen.findByText('node 0.1.2')).toBeInTheDocument();
    expect(screen.queryByText('backup of 27')).not.toBeInTheDocument();
    expect(screen.getByText('1 VMs with persistent disks have no backup.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Datastores/ }));
    expect(await screen.findByText(/64 GiB used of 250 GiB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Backups/ }));
    expect((await screen.findAllByText('daily-masters')).length).toBe(2); // the job and the VM it backs up
    expect(screen.getByText('No backup (persistent disks)')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });
});
