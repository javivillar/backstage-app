import '@testing-library/jest-dom';
import { fireEvent, screen, within } from '@testing-library/react';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { TestApiProvider, renderInTestApp } from '@backstage/test-utils';
import { ImagesPage, daysUntil, needsAttention } from './ImagesPage';
// what GET /api/sbom/images answers with a published catalog (shape of plugins/sbom-backend/src/imageCatalog.ts)
import fixture from './images.fixture.json';

function render(body: unknown, status = 200) {
  const fetch = jest.fn(async (_url: string) => new Response(JSON.stringify(body), { status }));
  return {
    fetch,
    view: renderInTestApp(
      <TestApiProvider
        apis={[
          [discoveryApiRef, { getBaseUrl: async () => 'http://backstage/api/sbom' }],
          [fetchApiRef, { fetch }],
        ]}
      >
        <ImagesPage />
      </TestApiProvider>,
    ),
  };
}

describe('ImagesPage', () => {
  it('starts with the images a system may use, and shows all with the toggle', async () => {
    const { fetch } = render(fixture);
    const table = await screen.findByRole('table', { name: 'images' });
    expect(fetch).toHaveBeenCalledWith('http://backstage/api/sbom/images');
    expect(within(table).getAllByText('common/postgres')).toHaveLength(2);
    expect(within(table).getByText('framework-python/python')).toBeInTheDocument();
    expect(within(table).queryByText('common/grafana')).not.toBeInTheDocument();
    expect(within(table).getByText('deprecated → common/postgres:18-alpine3.24')).toBeInTheDocument();
    expect(within(table).getByText('C 1')).toBeInTheDocument();
    expect(screen.getByText(/3 of 4 images/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(within(table).getByText('common/grafana')).toBeInTheDocument();
    expect(within(table).getByText('platform')).toBeInTheDocument();
    // asking for an image: the template that opens the pull request in opennebula
    expect(screen.getByRole('button', { name: 'Request an image' })).toHaveAttribute('href', '/create/templates/default/harbor-request-image');
  });

  it('filters by text', async () => {
    render(fixture);
    await screen.findByRole('table', { name: 'images' });
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'fastapi' } });
    const table = screen.getByRole('table', { name: 'images' });
    expect(within(table).queryByText('common/postgres')).not.toBeInTheDocument();
    expect(within(table).getByText('framework-python/python')).toBeInTheDocument();
  });

  it('warns when the catalog of the host is not published, and shows everything', async () => {
    render({ ...fixture, catalog: { published: false } });
    expect(await screen.findByText(/The catalog of the host is not published yet/)).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'images' })).getByText('common/grafana')).toBeInTheDocument();
  });

  it('says when it is not configured', async () => {
    render({ configured: false, categories: {}, images: [], errors: [] });
    expect(await screen.findByText(/Not configured/)).toBeInTheDocument();
  });

  it('shows the error of the API', async () => {
    render({ error: 'boom' }, 502);
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('shows the supply chain: signature of Refresquito, held update, not copied yet, status and the attention filter', async () => {
    const body = JSON.parse(JSON.stringify(fixture));
    const tags = body.images.flatMap((i: { tags: object[] }) => i.tags);
    for (const t of tags) t.refresquitoSigned = true;
    tags[0].quarantine = { digest: 'sha256:0123456789abcdef', reasons: ['postgres:18 (linux/amd64) CVE-1 zlib Critical (no VEX statement)'] };
    tags[3].inHarbor = false;
    tags[3].refresquitoSigned = false;
    body.supplyChain = { airgapped: false, vulnerabilityDb: { updatedAt: new Date().toISOString(), source: 'online' }, lastBundle: null };
    render(body);
    const table = await screen.findByRole('table', { name: 'images' });
    expect(within(table).getAllByText('Refresquito').length).toBeGreaterThan(0);
    expect(within(table).getByText('update held')).toBeInTheDocument();
    expect(within(table).getByText('requested, not in Harbor yet')).toBeInTheDocument();
    const status = screen.getByLabelText('supply chain status');
    expect(within(status).getByText(/^Vulnerability database of/)).toBeInTheDocument();
    expect(within(status).getByText('3 of 3 signed by Refresquito')).toBeInTheDocument();
    expect(within(status).getByText('1 update(s) held in the quarantine')).toBeInTheDocument();
    // needs attention: the held update, postgres 14 (end of life soon), python (1 critical, not in Harbor)
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.click(screen.getByRole('button', { name: 'needs attention' }));
    expect(within(table).queryByText('common/grafana')).not.toBeInTheDocument();
    expect(within(table).getByText('framework-python/python')).toBeInTheDocument();
  });

  it('says why an image needs attention', () => {
    const base = { eol: '', scan: undefined, quarantine: undefined, inHarbor: true, refresquitoSigned: true };
    expect(needsAttention(base)).toEqual([]);
    expect(needsAttention({ ...base, eol: '2000-01-01' })).toEqual(['past its end of life']);
    expect(needsAttention({ ...base, refresquitoSigned: false })).toEqual(['not signed by Refresquito']);
    expect(needsAttention({ ...base, inHarbor: false, refresquitoSigned: false })).toEqual(['not in Harbor yet']);
    expect(needsAttention({ ...base, quarantine: { digest: 'sha256:x', reasons: [] } })).toEqual(['update held in the quarantine']);
  });

  it('counts days to an end of life', () => {
    const today = new Date('2026-10-31T12:00:00Z');
    expect(daysUntil('2026-11-12', today)).toBe(12);
    expect(daysUntil('2026-10-01', today)).toBe(-30);
    expect(daysUntil('nope', today)).toBeUndefined();
  });
});
