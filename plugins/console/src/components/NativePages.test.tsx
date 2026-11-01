import { configApiRef, discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { MockConfigApi, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CisNodesPage } from './CisNodesPage';
import { eolDays, ImageCatalogPage } from './ImageCatalogPage';

const compliance = {
  configured: true,
  generated: '2026-11-01T10:00:00Z',
  stale: [],
  nodes: [
    { node: 'master-0', policy: 'cis_ubuntu22', scanEnd: '2026-11-01T09:00:00Z', score: 99, inScope: 100, passed: 99, failed: 0, accepted: 2, status: 'clean', failures: [] },
    { node: 'worker-1', policy: 'cis_ubuntu22', scanEnd: '2026-11-01T09:00:00Z', score: 88, inScope: 100, passed: 88, failed: 2, accepted: 0, status: 'failures', failures: [{ checkId: 1, cis: '1.1.2', title: 'Ensure /tmp is a separate partition', change: 'new_fail', remediation: 'Mount /tmp separately' }] },
  ],
};
const catalog = {
  configured: true,
  harbor: 'https://harbor.x',
  errors: [],
  images: [
    { repository: 'common/postgres', name: 'postgres', harborUrl: '', tags: [
      { tag: '18-alpine3.24', category: 'Databases', audience: 'apps', state: 'approved', replacedBy: '', version: '18', title: 'PostgreSQL 18', license: 'PostgreSQL', eol: '2030-11-14', scan: { critical: 0, high: 0 }, sourceSignatureVerified: true, attestations: ['SBOM'] },
      { tag: '14-alpine3.24', category: 'Databases', audience: 'apps', state: 'deprecated', replacedBy: '18-alpine3.24', version: '14', title: 'PostgreSQL 14', license: 'PostgreSQL', eol: '2026-11-12', scan: { critical: 1, high: 2 }, sourceSignatureVerified: false, attestations: [] },
    ] },
  ],
};

const wrap = (children: ReactNode) =>
  renderInTestApp(
    <TestApiProvider
      apis={[
        [configApiRef, new MockConfigApi({ console: { enabled: true, cluster: { id: 'nato-sirtap', kind: 'program' } } })],
        [discoveryApiRef, { getBaseUrl: async (id: string) => `http://b/api/${id}` }],
        [fetchApiRef, { fetch: async (url: RequestInfo | URL) => new Response(JSON.stringify(String(url).endsWith('/compliance') ? compliance : catalog)) }],
      ]}
    >
      {children}
    </TestApiProvider>,
  );

describe('pages the console draws itself', () => {
  it('shows the CIS hardening of every node, the worst first, and what to fix', async () => {
    await wrap(<CisNodesPage />);
    expect(await screen.findByText('CIS hardening of nato-sirtap')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    const names = screen.getAllByText(/^(master-0|worker-1)$/).map(e => e.textContent);
    expect(names).toEqual(['worker-1', 'master-0']);
    fireEvent.click(screen.getByRole('button', { name: 'What failed on worker-1' }));
    expect(screen.getByText('Ensure /tmp is a separate partition')).toBeInTheDocument();
    expect(screen.getByText(/Mount \/tmp separately/)).toBeInTheDocument();
  });

  it('shows the image catalog and what needs attention', async () => {
    await wrap(<ImageCatalogPage />);
    expect(await screen.findByText('common/postgres:18-alpine3.24')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Needs attention' }));
    expect(screen.queryByText('common/postgres:18-alpine3.24')).not.toBeInTheDocument();
    expect(screen.getByText('common/postgres:14-alpine3.24')).toBeInTheDocument();
    expect(screen.getByText('1 C · 2 H')).toBeInTheDocument();
    expect(eolDays('2026-11-12', Date.parse('2026-11-01'))).toBe(11);
  });
});
