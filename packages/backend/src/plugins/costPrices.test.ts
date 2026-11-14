import { changeLines, kindOf, nextVersion, numberText, priceChange, PriceError, readChanges, readPrices, withChangelog, withChartVersion, withOverview, withPrices } from './costPrices';

const VALUES = `backstage:
  image:
    tag: "abc"   # the image
opencost:
  enabled: true
  # The prices, per hour.
  pricing:
    description: "Example prices (not yet the cost base)"
    currency: EUR
    cpuPerCoreHour: 0.0205
    ramPerGiBHour: 0.0027   # about 2 EUR a month
    storagePerGiBHour: 0.0001
    gpuPerHour: 0
    gpuNodeLabel: ""
    spot:
      cpuPerCoreHour: 0.0205
      ramPerGiBHour: 0.0027
      # "label=value" of the nodes charged at these prices
      nodeLabel: ""
    network:
      zoneEgressPerGiB: 0
      internetEgressPerGiB: 0
    loadBalancer:
      perHour: 0
    discount:
      sustainedUse: 0
      negotiated: 0
    # Charged once per deployment
    perDeployment: 0.50
    perIncident:
      P1: 50
      P2: 25
    assistants:
      # the subscription
      - model: claude-opus
        inputPerMillion: 4.6
        outputPerMillion: 23
      - model: "*"
        runner: api
        perHour: 0.40
  resources:
    requests: { cpu: 50m, memory: 192Mi }
other:
  pricing:
    cpuPerCoreHour: 9
`;

describe('reading the prices', () => {
  it('gives each price by its path, assistants by model and runner', () => {
    const { prices, currency, description } = readPrices(VALUES);
    expect(currency).toBe('EUR');
    expect(description).toMatch(/^Example prices/);
    expect(prices).toMatchObject({
      cpuPerCoreHour: 0.0205, gpuPerHour: 0, gpuNodeLabel: '', 'spot.nodeLabel': '', 'network.internetEgressPerGiB': 0, 'discount.negotiated': 0, perDeployment: 0.5,
      'perIncident.P2': 25, 'assistants.claude-opus.outputPerMillion': 23, 'assistants.*@api.perHour': 0.4,
    });
    expect(Object.keys(prices)).not.toContain('currency');
    expect(readPrices('a: 1\n').prices).toEqual({});
  });
  it('knows what is a price', () => {
    expect(kindOf('cpuPerCoreHour')).toBe('money');
    expect(kindOf('discount.negotiated')).toBe('percent');
    expect(kindOf('assistants.claude-opus.inputPerMillion')).toBe('money');
    expect(kindOf('assistants.claude-opus.model')).toBeUndefined();
    expect(kindOf('currency')).toBeUndefined();
    expect(kindOf('enabled')).toBeUndefined();
  });
});

describe('the changes asked', () => {
  it('takes numbers and labels of the right kind', () => {
    expect(readChanges({ cpuPerCoreHour: 0.024, 'discount.negotiated': 15, 'spot.nodeLabel': 'refresquito.io/priority=low', gpuNodeLabel: 'nvidia.com/gpu.product' })).toEqual({
      cpuPerCoreHour: 0.024, 'discount.negotiated': 15, 'spot.nodeLabel': 'refresquito.io/priority=low', gpuNodeLabel: 'nvidia.com/gpu.product',
    });
  });
  it.each([
    [undefined], [[]], [{}], [{ currency: 'USD' }], [{ cpuPerCoreHour: -1 }], [{ cpuPerCoreHour: '0.1' }], [{ cpuPerCoreHour: NaN }], [{ 'discount.negotiated': 101 }],
    [{ 'spot.nodeLabel': 'no value' }], [{ gpuNodeLabel: 'a=b' }], [{ 'assistants.x.model': 1 }], [{ '__proto__.x': 1 }],
  ])('refuses %j', body => {
    expect(() => readChanges(body)).toThrow(PriceError);
  });
});

describe('changing the values file', () => {
  it('changes only the values asked, keeping comments and layout', () => {
    const { text, changed } = withPrices(VALUES, { cpuPerCoreHour: 0.024, ramPerGiBHour: 0.003, 'network.internetEgressPerGiB': 0.02, 'spot.nodeLabel': 'tier=low', 'assistants.*@api.perHour': 0.5, 'perIncident.P1': 50 });
    expect(changed.map(c => c.path)).toEqual(['cpuPerCoreHour', 'ramPerGiBHour', 'network.internetEgressPerGiB', 'spot.nodeLabel', 'assistants.*@api.perHour']);
    const before = VALUES.split('\n');
    const after = text.split('\n');
    expect(after).toHaveLength(before.length);
    expect(after.filter((l, i) => l !== before[i])).toEqual([
      '    cpuPerCoreHour: 0.024',
      '    ramPerGiBHour: 0.003   # about 2 EUR a month',
      '      nodeLabel: "tier=low"',
      '      internetEgressPerGiB: 0.02',
      '        perHour: 0.5',
    ]);
    // the price of the same name under spot and under another block is not touched
    expect(readPrices(text).prices['spot.cpuPerCoreHour']).toBe(0.0205);
    expect(text).toContain('other:\n  pricing:\n    cpuPerCoreHour: 9');
  });
  it('refuses a price the file does not have, and a change that changes nothing', () => {
    expect(() => withPrices(VALUES, { 'network.regionEgressPerGiB': 1 })).toThrow(/not in the values/);
    expect(() => withPrices(VALUES, { 'assistants.claude-sonnet.inputPerMillion': 1 })).toThrow(/not in the values/);
    expect(() => withPrices(VALUES, { cpuPerCoreHour: 0.0205 })).toThrow(/already/);
  });
  it('writes numbers without an exponent', () => {
    expect(numberText(0.0000001)).toBe('0.0000001');
    expect(numberText(50)).toBe('50');
    expect(numberText(0.5)).toBe('0.5');
    expect(withPrices(VALUES, { storagePerGiBHour: 0.00000005 }).text).toContain('storagePerGiBHour: 0.00000005');
  });
});

const CHART = 'apiVersion: v2\nname: cnoe-oneke\nversion: 0.2.119\nappVersion: "1.0"\n';
const CHANGELOG = '# Release notes of cnoe-oneke\n\nIntro.\n\n## 0.2.119 - 2026-11-14\n\n- Something.\n\n## 0.2.118 - 2026-11-14\n\n- Older.\n';
const OVERVIEW = '# Backstage\n\n| | |\n|---|---|\n| Chart | `charts/cnoe-oneke`, version 0.2.119 |\n| Namespace | `x` |\n\n## Latest release\n\n**0.2.119 - 2026-11-14**\n\n- Something.\n\nEvery version: [Release notes](changelog.md).\n\n## Documents\n';
const VERSIONS = '# Generated\n"clamav-mirror-oneke": "0.1.0"\n"cnoe-oneke": "0.2.119"\n"console-vms-oneke": "0.2.0"\n';

describe('the files of the pull request', () => {
  it('raises the patch version of the chart', () => {
    expect(nextVersion(CHART)).toMatchObject({ version: '0.2.119', next: '0.2.120' });
    expect(nextVersion(CHART).text).toContain('version: 0.2.120\nappVersion: "1.0"');
    expect(() => nextVersion('name: x\n')).toThrow(PriceError);
  });
  it('puts the entry first in the release notes, and on the overview as gen-techdocs.py does', () => {
    expect(withChangelog(CHANGELOG, '0.2.120', '2026-11-15', '- New.')).toBe(CHANGELOG.replace('## 0.2.119', '## 0.2.120 - 2026-11-15\n\n- New.\n\n## 0.2.119'));
    const o = withOverview(OVERVIEW, 'cnoe-oneke', '0.2.120', '2026-11-15', '- New $1.');
    expect(o).toContain('version 0.2.120 |');
    expect(o).toContain('## Latest release\n\n**0.2.120 - 2026-11-15**\n\n- New $1.\n\nEvery version: ');
    expect(o).not.toContain('Something');
    expect(withChartVersion(VERSIONS, 'cnoe-oneke', '0.2.120')).toBe(VERSIONS.replace('0.2.119', '0.2.120'));
    expect(() => withOverview('# x\n', 'cnoe-oneke', '1', 'd', 'b')).toThrow(PriceError);
    expect(() => withChartVersion(VERSIONS, 'other', '1')).toThrow(PriceError);
  });
  it('says each change with its unit', () => {
    expect(changeLines([{ path: 'cpuPerCoreHour', from: 0.0205, to: 0.024 }, { path: 'discount.negotiated', from: 0, to: 15 }, { path: 'spot.nodeLabel', from: '', to: 'tier=low' }], 'EUR')).toEqual([
      '  - `cpuPerCoreHour`: 0.0205 EUR → 0.024 EUR',
      '  - `discount.negotiated`: 0 % → 15 %',
      '  - `spot.nodeLabel`: none → `tier=low`',
    ]);
  });
  it('builds the five files and the text of the pull request', () => {
    const c = priceChange({ values: VALUES, chart: CHART, changelog: CHANGELOG, overview: OVERVIEW, versions: VERSIONS }, { cpuPerCoreHour: 0.024, gpuPerHour: 0.85 }, { chart: 'cnoe-oneke', by: 'user:default/ana', date: '2026-11-15' });
    expect(c.next).toBe('0.2.120');
    expect(c.title).toBe('cnoe-oneke 0.2.120: 2 prices');
    expect(c.body).toContain('- `gpuPerHour`: 0 EUR → 0.85 EUR');
    expect(c.files.map(f => f.path)).toEqual([
      'charts/cnoe-oneke/values.yaml', 'charts/cnoe-oneke/Chart.yaml', 'charts/cnoe-oneke/CHANGELOG.md', 'charts/cnoe-oneke/docs/index.md', 'bootstrap/app-of-apps/files/chart-versions.yaml',
    ]);
    expect(c.files[2].text).toContain('## 0.2.120 - 2026-11-15\n\n- **Prices** changed from the console (FinOps › Prices) by user:default/ana:\n  - `cpuPerCoreHour`: 0.0205 EUR → 0.024 EUR\n  - `gpuPerHour`: 0 EUR → 0.85 EUR\n\n## 0.2.119');
    expect(priceChange({ values: VALUES, chart: CHART, changelog: CHANGELOG, overview: OVERVIEW, versions: VERSIONS }, { perDeployment: 1 }, { chart: 'cnoe-oneke', by: 'u', date: 'd' }).title).toBe('cnoe-oneke 0.2.120: price perDeployment');
  });
});
