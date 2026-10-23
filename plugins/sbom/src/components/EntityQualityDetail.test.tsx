import { fireEvent, screen } from '@testing-library/react';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { TestApiProvider, renderInTestApp } from '@backstage/test-utils';
import { EntityQualityDetailContent, ExceptionsTab } from './EntityQualityDetail';
// quality.py exceptions of petstore#25 on a sample file: 2 active, 1 expired, 3 invalid
import exceptionsPart from './exceptions.fixture.json';
import report from './quality.fixture.json';
// quality.py of petstore#21 on real tool outputs: the endpoints of the petstore plus one without authentication and one
// declared public, Bandit and eslint on probe files, gitleaks and Trivy on probe secrets
import codeFindings from './code-findings.fixture.json';

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
    expect(await screen.findByText('Tests, coverage & code findings')).toBeInTheDocument();
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

  it('shows the code findings: the operation without authentication first, the worst findings first, no secret', async () => {
    const { view } = render({ image: 'x', attached: null, report: codeFindings });
    await view;
    fireEvent.click(await screen.findByRole('tab', { name: 'Code findings' }));
    expect(screen.getByText('1 operations without authentication')).toBeInTheDocument();
    expect(screen.getByText('5 static analysis findings')).toBeInTheDocument();
    expect(screen.getByText('3 secrets')).toBeInTheDocument();
    expect(screen.getByText('2 low (not counted)')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    // endpoints: the one without authentication first, then the declared public with its reason
    expect(rows[1]).toHaveTextContent('GET /api/pets/export');
    expect(rows[1]).toHaveTextContent('none');
    expect(screen.getByText('version shown on the sign-in page')).toBeInTheDocument();
    expect(screen.queryByText(/\/health\/live/)).not.toBeInTheDocument();
    // findings: the critical secret of an image first; the secret itself is nowhere
    const findings = rows.filter(r => /bandit|eslint|gitleaks|trivy/.test(r.textContent ?? ''));
    expect(findings[0]).toHaveTextContent('critical');
    expect(findings[0]).toHaveTextContent('github-pat');
    expect(findings[0]).toHaveTextContent('image web: /app/.env:1');
    expect(screen.getByText(/B602/)).toBeInTheDocument();
    expect(screen.getByText(/bypassSecurityTrust/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ghp_|BEGIN .*PRIVATE KEY/);
  });

  it('says when a report has no code findings yet', async () => {
    const { view } = render({ image: 'x', attached: null, report });
    await view;
    fireEvent.click(await screen.findByRole('tab', { name: 'Code findings' }));
    expect(screen.getByText(/has no code findings/)).toBeInTheDocument();
  });

  it('shows the exceptions: invalid ones with why, active ones until when, and the ones expired since', async () => {
    await renderInTestApp(<ExceptionsTab part={exceptionsPart as never} today="2026-12-15" />);
    expect(screen.getByText('Invalid exceptions (they do not apply)')).toBeInTheDocument();
    expect(screen.getByText(/file is required for a sast \/ secret exception/)).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    // CVE-2023-44487 applies until 2027-03-31; GET /api/info expires on 2026-12-31: soon; some-lib had expired
    expect(rows[0]).toHaveTextContent('CVE-2023-44487');
    expect(rows[0]).toHaveTextContent('applies');
    expect(rows[0]).toHaveTextContent('image ghcr.io/javivillar/petstore-web');
    expect(rows[1]).toHaveTextContent('GET /api/info');
    expect(rows[1]).toHaveTextContent('expires soon');
    expect(rows[2]).toHaveTextContent('some-lib');
    expect(rows[2]).toHaveTextContent('expired: the finding counts again');
  });

  it('an exception that expired after the CI accepted it no longer applies', async () => {
    await renderInTestApp(<ExceptionsTab part={exceptionsPart as never} today="2027-01-15" />);
    expect(screen.getAllByText('expired: the finding counts again')).toHaveLength(2);
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
