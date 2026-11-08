import type { MapData, MapProcess } from '../../businessMap';
import {
  explorerCsv,
  explorerRows,
  filterOptions,
  filterRows,
  NO_EXPLORER_FILTER,
  openAll,
  openFor,
  openToLevel,
  visibleRows,
  worstResult,
  type ExplorerFilter,
} from './explorerModel';

// made-up data: two level-1 domains, a subdomain, processes and sub-processes
const proc = (name: string, id: string, extra: Partial<MapProcess> = {}): MapProcess => ({
  ref: `businessprocess:customer/${name}`,
  name,
  namespace: 'customer',
  title: name,
  domain: 'domain:customer/repairs',
  criticality: 'standard',
  requirement: { rpo: '24h', rto: '72h', retention: null, from: { rpo: 'default', rto: 'default' } },
  dependsOn: [],
  result: 'meets',
  gaps: [],
  services: [],
  dataProducts: [],
  pcfId: id,
  ...extra,
});
const MAP: Pick<MapData, 'domains' | 'processes'> = {
  domains: [
    { ref: 'domain:customer/office', title: 'Office', pcfId: '10.0' },
    { ref: 'domain:customer/after-sales', title: 'After sales', pcfId: '6.0' },
    { ref: 'domain:customer/repairs', title: 'Repairs', pcfId: '6.3', parent: 'domain:customer/after-sales' },
  ],
  processes: [
    proc('repair', '6.3.1', { criticality: 'critical', requirement: { rpo: '15m', rto: '4h', retention: null, from: { rpo: 'default', rto: 'default' } }, result: 'gap', owner: 'group:default/a-team', dependsOn: ['system:default/shop'], description: 'Repair the fleet' }),
    proc('plan', '6.3.1.2', { parent: 'businessprocess:customer/repair', criticality: 'critical', inherited: ['criticality', 'dependsOn'], dependsOn: ['system:default/shop'], result: 'gap' }),
    proc('análisis', '6.3.1.10', { parent: 'businessprocess:customer/repair', result: 'unknown' }),
    proc('order', '6.3.2'),
    proc('pay', '10.1.1', { domain: 'domain:customer/office', owner: 'group:default/unassigned' }),
  ],
};

describe('explorerRows', () => {
  const rows = explorerRows(MAP);
  it('flattens the tree depth first, by ID as numbers', () => {
    expect(rows.map(r => `${r.level} ${r.type} ${r.id}`)).toEqual([
      '1 domain 6.0',
      '2 subdomain 6.3',
      '3 process 6.3.1',
      '4 subprocess 6.3.1.2',
      '4 subprocess 6.3.1.10',
      '3 process 6.3.2',
      '1 domain 10.0',
      '2 process 10.1.1',
    ]);
  });
  it('says what is inherited, the worst check of a domain, applications and owner', () => {
    const plan = rows.find(r => r.id === '6.3.1.2')!;
    expect([plan.criticalityInherited, plan.applicationsInherited, plan.applications, plan.root]).toEqual([true, true, ['shop'], 'domain:customer/after-sales']);
    expect(rows.find(r => r.id === '6.0')!.result).toBe('gap');
    expect(rows.find(r => r.id === '10.0')!.result).toBe('meets');
    expect(rows.find(r => r.id === '10.1.1')!.owner).toBe('');
    expect(rows.find(r => r.id === '6.3.1')!).toMatchObject({ owner: 'a-team', rpo: '15m', rto: '4h', children: 2, description: 'Repair the fleet' });
    expect(worstResult([])).toBeUndefined();
  });
});

describe('filters, open rows and pages', () => {
  const rows = explorerRows(MAP);
  const f = (x: Partial<ExplorerFilter>) => ({ ...NO_EXPLORER_FILTER, ...x });
  it('a search shows the matches with their ancestors, accents ignored', () => {
    const got = filterRows(rows, f({ text: 'analisis' }));
    expect(got.map(r => [r.id, r.match])).toEqual([
      ['6.0', false],
      ['6.3', false],
      ['6.3.1', false],
      ['6.3.1.10', true],
    ]);
    expect([...openFor(got)].sort()).toEqual(['businessprocess:customer/repair', 'domain:customer/after-sales', 'domain:customer/repairs']);
    expect(filterRows(rows, f({ text: 'fleet' })).filter(r => r.match).map(r => r.id)).toEqual(['6.3.1']);
  });
  it('filters by level, level-1 domain, criticality, check and owner', () => {
    const ids = (x: Partial<ExplorerFilter>) => filterRows(rows, f(x)).filter(r => r.match).map(r => r.id);
    expect(ids({ level: '4' })).toEqual(['6.3.1.2', '6.3.1.10']);
    expect(ids({ root: 'domain:customer/office' })).toEqual(['10.0', '10.1.1']);
    expect(ids({ criticality: 'critical' })).toEqual(['6.3.1', '6.3.1.2']);
    expect(ids({ result: 'unknown' })).toEqual(['6.3.1.10']);
    expect(ids({ owner: 'a-team' })).toEqual(['6.3.1']);
    expect(filterRows(rows, NO_EXPLORER_FILTER).every(r => r.match)).toBe(true);
  });
  it('shows what is open: collapsed to level 3, or everything', () => {
    expect(visibleRows(rows, openToLevel(rows, 3)).map(r => r.id)).toEqual(['6.0', '6.3', '6.3.1', '6.3.2', '10.0', '10.1.1']);
    expect(visibleRows(rows, openAll(rows))).toHaveLength(rows.length);
    expect(visibleRows(rows, new Set()).map(r => r.id)).toEqual(['6.0', '10.0']);
  });
  it('the options of the filters', () => {
    expect(filterOptions(rows)).toEqual({
      levels: [1, 2, 3, 4],
      roots: [
        { key: 'domain:customer/after-sales', label: '6.0 After sales' },
        { key: 'domain:customer/office', label: '10.0 Office' },
      ],
      owners: ['a-team'],
    });
  });
  it('the CSV of the rows, with the BOM for Excel and quoted cells', () => {
    const csv = explorerCsv(filterRows(rows, f({ text: 'fleet' })));
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Level,Type,ID,Title,Description,Criticality,Criticality inherited,RPO,RTO,Check,Applications,Owner,Match');
    expect(lines[3]).toBe('3,process,6.3.1,repair,Repair the fleet,critical,,15m,4h,gap,shop,a-team,yes');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(explorerCsv([{ ...rows[0], title: 'A, "B"', match: true }]).split('\r\n')[1]).toContain('"A, ""B"""');
  });
});
