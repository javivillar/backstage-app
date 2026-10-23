import { fireEvent, screen, within } from '@testing-library/react';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { TestApiProvider, renderInTestApp } from '@backstage/test-utils';
import { LicensePolicy, Vulnerabilities, byUrgency, epssText } from './EntitySbom';
import type { Vulnerability } from '../api';
// the answer of the security exporter of wazuh-oneke 0.20.0 for nginx:1.25.2 (local run of 2026-10-23, trimmed):
// behind an Ingress, 2 CRITICAL in packages in use and 15 in packages never loaded
import fixture from './vulnerabilities.fixture.json';

function render(body: unknown) {
  const fetch = jest.fn(async (_url: string) => new Response(JSON.stringify(body), { status: 200 }));
  return renderInTestApp(
    <TestApiProvider
      apis={[
        [discoveryApiRef, { getBaseUrl: async () => 'http://backstage/api/sbom' }],
        [fetchApiRef, { fetch }],
      ]}
    >
      <Vulnerabilities image="docker.io/library/nginx:1.25.2" />
    </TestApiProvider>,
  );
}

describe('Vulnerabilities card', () => {
  it('shows the context Wazuh gives: KEV first, EPSS, days open, in use, exposure, the feeds', async () => {
    await render(fixture);
    expect(await screen.findByText('known exploited (CISA KEV) 2')).toBeInTheDocument();
    expect(screen.getByText(/highest EPSS 100 % \(CVE-2023-44487\)/)).toBeInTheDocument();
    expect(screen.getByText(/oldest fixable critical open 0 days, high 0 days/)).toBeInTheDocument();
    expect(screen.getByText(/2 critical in packages in use, 15 in packages never loaded/)).toBeInTheDocument();
    expect(screen.getByText('reachable from outside the cluster · segment apps')).toBeInTheDocument();
    expect(screen.getByText(/CISA KEV 2026.10.21 · EPSS of 2026-10-22 · packages in use of 2026-10-23/)).toBeInTheDocument();
    expect(screen.getByText(/days counted since 2026-10-23/)).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    // the known exploited come first, in use before never loaded (CVE-2023-44487 is in use through the nginx package)
    expect(within(rows[0]).getByText('KEV')).toBeInTheDocument();
    expect(within(rows[0]).getByText('CVE-2023-44487')).toBeInTheDocument();
    expect(within(rows[0]).getByText('yes')).toBeInTheDocument();
    expect(within(rows[0]).getByText('network')).toBeInTheDocument();
    expect(rows.filter(r => within(r).queryByText('KEV'))).toHaveLength(3);
  });

  it('filters the findings in packages never loaded', async () => {
    await render(fixture);
    fireEvent.mouseDown((await screen.findAllByRole('combobox'))[2]);
    fireEvent.click(await screen.findByText('Never loaded'));
    const column = screen.getAllByRole('columnheader').findIndex(h => h.textContent === 'In use');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(within(row).getAllByRole('cell')[column]).toHaveTextContent('no');
  });

  it('filters the known exploited', async () => {
    await render(fixture);
    fireEvent.mouseDown((await screen.findAllByRole('combobox'))[0]);
    fireEvent.click(await screen.findByText('Known exploited (KEV)'));
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(within(row).getByText('KEV')).toBeInTheDocument();
  });

  it('says unknown, not zero, when the KEV feed was missing; and nothing when the scan has no context', async () => {
    const missing = JSON.parse(JSON.stringify(fixture));
    missing.scan.context.kev = null;
    missing.scan.feeds.kev = { status: 'missing', error: 'Name does not resolve' };
    missing.scan.vulns.forEach((v: Vulnerability) => delete v.kev);
    const { unmount } = await render(missing);
    expect(await screen.findByText('known exploited: unknown')).toBeInTheDocument();
    expect(screen.getByText(/CISA KEV: not available \(Name does not resolve\)/)).toBeInTheDocument();
    unmount();

    const old = JSON.parse(JSON.stringify(fixture));
    delete old.scan.context;
    delete old.scan.feeds;
    await render(old);
    expect(await screen.findByText(/No context \(EPSS, CISA KEV, age\) in this scan/)).toBeInTheDocument();
  });
});

describe('OS support and license policy', () => {
  it('says when the OS of the image is out of support', async () => {
    const eol = JSON.parse(JSON.stringify(fixture));
    eol.scan.os_eol = true;
    await render(eol);
    expect(await screen.findByText('OS out of support: no more security fixes')).toBeInTheDocument();
  });

  it('lists the dependencies with a denied license and the ones without a license', async () => {
    await renderInTestApp(
      <LicensePolicy
        report={{
          checked: 53,
          policy: { denied: ['GPL-*'], ecosystems: ['pypi', 'npm'], ignore: [] },
          denied: [{ name: 'gpl-lib', version: '1.0', ecosystem: 'pypi', licenses: ['GPL-3.0-only'], denied: ['GPL-3.0-only'] }],
          unknown: [{ name: 'petstore', version: '0.7.1', ecosystem: 'pypi', licenses: [] }],
        }}
      />,
    );
    expect(screen.getByText('1 with a denied license')).toBeInTheDocument();
    expect(screen.getByText('1 without a license')).toBeInTheDocument();
    expect(screen.getByText(/denied: GPL-3.0-only/)).toBeInTheDocument();
    expect(screen.getByText(/no license in the SBOM/)).toBeInTheDocument();
    expect(screen.getByText(/53 dependencies of the application/)).toBeInTheDocument();
  });
});

describe('helpers', () => {
  it('orders by urgency: known exploited, severity, EPSS', () => {
    const vulns: Vulnerability[] = [
      { id: 'CVE-3', sev: 'HIGH', epss: 0.9 },
      { id: 'CVE-1', sev: 'CRITICAL', epss: 0.01 },
      { id: 'CVE-2', sev: 'CRITICAL', epss: 0.5 },
      { id: 'CVE-4', sev: 'LOW', kev: true },
      { id: 'CVE-5', sev: 'HIGH' },
      { id: 'CVE-6', sev: 'CRITICAL', epss: 0.9, in_use: 'no' },
      { id: 'CVE-7', sev: 'HIGH', kev: true, in_use: 'no' },
    ];
    expect([...vulns].sort(byUrgency).map(v => v.id)).toEqual(['CVE-4', 'CVE-7', 'CVE-2', 'CVE-1', 'CVE-3', 'CVE-5', 'CVE-6']);
  });

  it('shows EPSS as a percentage', () => {
    expect(epssText(undefined)).toBe('');
    expect(epssText(0.0004)).toBe('< 0.1 %');
    expect(epssText(0.01234)).toBe('1.2 %');
    expect(epssText(0.27775)).toBe('28 %');
    expect(epssText(0.99999)).toBe('100 %');
  });
});
