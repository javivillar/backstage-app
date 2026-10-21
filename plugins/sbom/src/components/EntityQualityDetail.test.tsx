import { fireEvent, screen } from '@testing-library/react';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { TestApiProvider, renderInTestApp } from '@backstage/test-utils';
import { EntityQualityDetailContent } from './EntityQualityDetail';
import report from './quality.fixture.json';

const entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'petstore-oneke', annotations: { 'refresquito.io/sbom-images': 'ghcr.io/javivillar/petstore-api:5ba9326' } },
  spec: { type: 'service', owner: 'team', lifecycle: 'production' },
};

function render(body: unknown) {
  const fetch = jest.fn(async (_url: string) => new Response(JSON.stringify(body), { status: 200 }));
  return {
    fetch,
    view: renderInTestApp(
      <TestApiProvider
        apis={[
          [discoveryApiRef, { getBaseUrl: async () => 'http://backstage/api/sbom' }],
          [fetchApiRef, { fetch }],
        ]}
      >
        <EntityProvider entity={entity}>
          <EntityQualityDetailContent />
        </EntityProvider>
      </TestApiProvider>,
    ),
  };
}

describe('EntityQualityDetailContent', () => {
  it('shows every test, failures first with their message, and the coverage of each file', async () => {
    const { fetch, view } = render({ image: 'x', attached: null, report });
    await view;
    expect(fetch.mock.calls[0][0]).toBe('http://backstage/api/sbom/quality?ref=ghcr.io%2Fjavivillar%2Fpetstore-api%3A5ba9326');
    expect(await screen.findByText('Tests & coverage')).toBeInTheDocument();
    expect(screen.getByText('27 passed')).toBeInTheDocument();
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    // the failed test is the first row, with why
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('failed');
    expect(rows[1]).toHaveTextContent('AssertionError: assert 404 == 200');
    // the least covered file of the backend, with the lines no test runs
    expect(screen.getByText('src/petstore/openapi.py')).toBeInTheDocument();
    expect(screen.getByText('6, 8, 10, 12-13')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Frontend' }));
    expect(screen.getByText('Branches')).toBeInTheDocument();
    expect(screen.getByText('src/app/pets/pet-welcome.ts')).toBeInTheDocument();
  });

  it('says when a report has only the totals', async () => {
    const { view } = render({ image: 'x', attached: null, report: { schema: 'refresquito.quality/v1', backend: { tests: { total: 1, failures: 0, errors: 0, skipped: 0 } } } });
    await view;
    expect(await screen.findByText(/has only the totals/)).toBeInTheDocument();
  });

  it('says when the image has no report', async () => {
    const { view } = render({ image: 'x', attached: null, report: null });
    await view;
    expect(await screen.findByText(/has no quality report attached/)).toBeInTheDocument();
  });
});
