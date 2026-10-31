import '@testing-library/jest-dom';
import { fireEvent, screen, within } from '@testing-library/react';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { TestApiProvider, renderInTestApp } from '@backstage/test-utils';
import { EntityImageContent, ImageDetail, isImageAvailable } from './EntityImageContent';

const entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Resource',
  metadata: {
    name: 'image-common-pgvector',
    annotations: { 'refresquito.io/harbor-repository': 'common/pgvector', 'refresquito.io/image-tags': 'pg16-debian13, pg17-debian13' },
  },
  spec: { type: 'container-image', owner: 'platform-team' },
};

// GET /api/sbom/images/detail of the live Harbor for common/pgvector:pg16-debian13 (2026-10-31), trimmed
const detail: ImageDetail = {
  repository: 'common/pgvector',
  tag: 'pg16-debian13',
  digest: 'sha256:25a96c3cc69da1ff8b493dcd271d01d63ea1203587210f78aeb184d90fc18974',
  platforms: [{ platform: 'linux/amd64', digest: 'sha256:25a9' }],
  scan: { status: 'Success', scanner: 'Trivy v0.75.0', generatedAt: '2026-10-31T03:12:28Z' },
  findings: [
    { id: 'CVE-2026-6653', package: 'libxml2', version: '2.9.14', fixVersion: '', severity: 'Critical', score: 9.8, description: 'Use After Free', link: 'https://avd.aquasec.com/nvd/cve-2026-6653', coveredByVex: true, platforms: ['linux/amd64'] },
    { id: 'CVE-2026-16742', package: 'libsystemd0', version: '257.13', fixVersion: '', severity: 'High', score: 8.8, description: 'systemd-homed', coveredByVex: false, platforms: ['linux/amd64'] },
    { id: 'CVE-2026-1', package: 'zlib', version: '1.3', fixVersion: '1.3.1', severity: 'Medium', coveredByVex: false, description: '', platforms: ['linux/amd64'] },
  ],
  allowlist: { count: 7, expiresAt: '2026-11-07T03:16:46Z' },
  signatureAttached: false,
  attestations: [
    { predicateType: 'https://cyclonedx.org/bom/v1.6', digest: 'sha256:a' },
    { predicateType: 'https://openvex.dev/ns/v0.2.0', digest: 'sha256:b' },
    { predicateType: 'https://slsa.dev/provenance/v1', digest: 'sha256:c' },
  ],
  sbom: {
    total: 2,
    generator: 'docker-scout 1.29.0',
    ecosystems: { deb: 2 },
    licenses: { 'MIT': 1, 'PostgreSQL': 1 },
    components: [
      { name: 'libxml2', version: '2.9.14', ecosystem: 'deb', licenses: ['MIT'] },
      { name: 'postgresql-16', version: '16.10', ecosystem: 'deb', licenses: ['PostgreSQL'] },
    ],
  },
  provenance: {
    predicateType: 'https://slsa.dev/provenance/v1',
    builder: 'https://github.com/docker-hardened-images/definitions/actions/runs/41116342718/attempts/1',
    source: 'https://github.com/docker-hardened-images/definitions',
    revision: '4e49bc1a08c845a24c27d0ae75ef6f23b09d34ba',
    finishedOn: '2026-10-30T19:39:54Z',
  },
  history: [
    { digest: 'sha256:25a96c3cc69da1ff8b493dcd271d01d63ea1203587210f78aeb184d90fc18974', tags: ['pg16-debian13'], pushedAt: '2026-10-31T03:12:25Z', critical: 3, high: 18, scanned: true },
    { digest: 'sha256:0155a0d2a5fba3c1734cbc1c0c48f3a195f92dd213da3cf2352f5671992c12ee', tags: [], pushedAt: '2026-10-30T03:26:20Z', critical: 3, high: 18, scanned: true },
  ],
  errors: [],
};

function render(body: unknown, status = 200) {
  const fetch = jest.fn(async (_url: string) => new Response(JSON.stringify(body), { status }));
  renderInTestApp(
    <TestApiProvider
      apis={[
        [discoveryApiRef, { getBaseUrl: async () => 'http://backstage/api/sbom' }],
        [fetchApiRef, { fetch }],
      ]}
    >
      <EntityProvider entity={entity}>
        <EntityImageContent />
      </EntityProvider>
    </TestApiProvider>,
  );
  return fetch;
}

describe('EntityImageContent', () => {
  it('shows findings with the ones covered by the VEX, the supply chain, the SBOM and the history', async () => {
    const fetch = render(detail);
    const findings = await screen.findByRole('table', { name: 'findings' });
    expect(fetch).toHaveBeenCalledWith('http://backstage/api/sbom/images/detail?repository=common%2Fpgvector&tag=pg16-debian13');
    expect(within(findings).getByText('CVE-2026-6653')).toBeInTheDocument();
    expect(within(findings).getByText('not affected')).toBeInTheDocument();
    expect(within(findings).queryByText('CVE-2026-1')).not.toBeInTheDocument();   // medium hidden by default
    expect(screen.getByText('covered by the VEX: 1 critical')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Hide covered by the VEX'));
    expect(within(screen.getByRole('table', { name: 'findings' })).queryByText('CVE-2026-6653')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Also medium and low'));
    expect(within(screen.getByRole('table', { name: 'findings' })).getByText('CVE-2026-1')).toBeInTheDocument();
    const chain = screen.getByRole('table', { name: 'supply chain' });
    expect(within(chain).getByText('none attached')).toBeInTheDocument();
    expect(within(chain).getByText('SBOM CycloneDX · VEX · SLSA provenance v1')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'components' })).getByText('postgresql-16')).toBeInTheDocument();
    const history = screen.getByRole('table', { name: 'history' });
    expect(within(history).getByText('untagged')).toBeInTheDocument();
    expect(within(history).getAllByText('3 / 18')).toHaveLength(2);
  });

  it('asks for another tag when one is chosen', async () => {
    const fetch = render(detail);
    await screen.findByRole('table', { name: 'findings' });
    fireEvent.click(screen.getByText('pg17-debian13'));
    await screen.findByRole('table', { name: 'findings' });
    expect(fetch).toHaveBeenLastCalledWith('http://backstage/api/sbom/images/detail?repository=common%2Fpgvector&tag=pg17-debian13');
  });

  it('shows the error of the API', async () => {
    render({ error: 'common/pgvector:pg16-debian13 is not in Harbor' }, 404);
    expect(await screen.findByText('common/pgvector:pg16-debian13 is not in Harbor')).toBeInTheDocument();
  });

  it('is only for entities of the image catalog', () => {
    expect(isImageAvailable(entity as any)).toBe(true);
    expect(isImageAvailable({ ...entity, metadata: { name: 'x' } } as any)).toBe(false);
  });
});
