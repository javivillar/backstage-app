import { parseAllDocuments } from 'yaml';
import { BIA_COLUMNS, biaWorkbook, pickBiaSheet, planBia } from './biaModel';
import { ContinuityGraph, type MapEntity, readDefaults } from './continuityModel';
import { A, type ModelEntity, parseRows, plan } from './importModel';
import { parseCsv, readXlsx, writeXlsx } from './sheets';

// made-up data
const DEFAULTS = readDefaults({ critical: { rpo: '15m', rto: '4h', ha: true }, standard: { rpo: '24h', rto: '72h' } });
const rel = (type: string, targetRef: string) => ({ type, targetRef });
const ENTITIES: MapEntity[] = [
  { kind: 'Domain', metadata: { name: 'after-sales', namespace: 'customer', title: 'After sales', annotations: { [A.pcfId]: '6.0' } }, spec: { type: 'business-area' } },
  { kind: 'Domain', metadata: { name: 'repairs', namespace: 'customer', title: 'Repairs', annotations: { [A.pcfId]: '6.3' } }, spec: { type: 'business-area', subdomainOf: 'after-sales' } },
  { kind: 'Domain', metadata: { name: 'office', namespace: 'customer', title: 'Office', annotations: { [A.pcfId]: '7.0' } }, spec: { type: 'business-area' } },
  {
    kind: 'BusinessProcess',
    metadata: { name: 'repair', namespace: 'customer', title: 'Repair', description: 'Repair the fleet', annotations: { [A.pcfId]: '6.3.1' } },
    spec: { criticality: 'critical', domain: 'repairs', owner: 'group:default/a-team', rto: '8h', mtpd: '2d', workaround: { manual: true, maxDuration: '1d' } },
    relations: [rel('dependsOn', 'system:default/shop'), rel('partOf', 'domain:customer/repairs'), rel('hasPart', 'businessprocess:customer/plan')],
  },
  {
    kind: 'BusinessProcess',
    metadata: { name: 'plan', namespace: 'customer', title: 'Plan', annotations: { [A.pcfId]: '6.3.1.1' } },
    spec: { domain: 'repairs', parentProcess: 'repair', owner: 'group:default/a-team' },
    relations: [rel('partOf', 'businessprocess:customer/repair')],
  },
  {
    kind: 'BusinessProcess',
    metadata: { name: 'pay', namespace: 'customer', title: 'Pay', annotations: { [A.pcfId]: '7.1.1' } },
    spec: { criticality: 'standard', domain: 'office' },
    relations: [rel('partOf', 'domain:customer/office')],
  },
  { kind: 'System', metadata: { name: 'shop', title: 'Shop' }, spec: { type: 'business-service' } },
];
const graph = () => new ContinuityGraph(ENTITIES, DEFAULTS);

describe('biaWorkbook', () => {
  it('one row per process with what the catalog says, and the guide', () => {
    const book = biaWorkbook(graph(), DEFAULTS, { namespace: 'customer' })!;
    expect(book.file).toBe('bia-customer.xlsx');
    const [bia, guide] = book.sheets;
    expect(bia.rows[0]).toEqual([...BIA_COLUMNS]);
    expect(bia.rows.slice(1).map(r => r[0])).toEqual(['6.3.1', '7.1.1']);
    const row = Object.fromEntries(BIA_COLUMNS.map((c, i) => [c, bia.rows[1][i]]));
    expect(row).toEqual({
      ID: '6.3.1', Domain: 'After sales', Subdomain: 'Repairs', Process: 'Repair', Description: 'Repair the fleet', Owner: 'a-team',
      Criticality: 'critical', RPO: '', RTO: '8h', MTPD: '2d', Retention: '', Workaround: 'yes', 'Workaround max': '1d', Applications: 'shop', Notes: '',
    });
    expect(guide.rows.some(r => r[0] === 'critical' && r[1].includes('RPO 15m'))).toBe(true);
  });
  it('a level-1 domain only, and the sub-processes after their parent', () => {
    const book = biaWorkbook(graph(), DEFAULTS, { namespace: 'customer', domain: 'after-sales', level: 'all' })!;
    expect(book.file).toBe('bia-customer-after-sales-all.xlsx');
    expect(book.sheets[0].rows.slice(1).map(r => r[0])).toEqual(['6.3.1', '6.3.1.1']);
    expect(biaWorkbook(graph(), DEFAULTS, { namespace: 'nobody' })).toBeUndefined();
  });
  it('the written workbook is read back as the sheet of the analysis', () => {
    const book = biaWorkbook(graph(), DEFAULTS, { namespace: 'customer' })!;
    const sheet = pickBiaSheet(readXlsx(writeXlsx(book.sheets)));
    expect(sheet.name).toBe('BIA');
    expect(sheet.rows[1].cells.slice(0, 4)).toEqual(['6.3.1', 'After sales', 'Repairs', 'Repair']);
  });
});

// the files of the namespace, as a first APQC import writes them (made-up rows)
const APQC = `PCF ID,Hierarchy ID,Name
1,6.0,After sales
2,6.3,Repairs
3,6.3.1,Repair
4,6.3.1.1,Plan
`;
const DIR = 'catalog/business-map/customer';
const opts = { namespace: 'customer', dir: DIR, today: '2026-11-08' };
const first = plan(parseRows(parseCsv(APQC), { source: 'apqc' }).drafts, [], { ...opts, goneFamily: 'apqc' }).files;
const docOf = (files: Array<{ path: string; text: string }>, name: string) => {
  const f = files.find(x => x.path === `${DIR}/process-${name}.yaml`);
  return f ? (parseAllDocuments(f.text)[0].toJS() as ModelEntity) : undefined;
};
const known = { knownGroups: new Set(['group:default/a-team']), knownEntities: new Set(['system:default/shop']) };
const sheet = (rows: string[]) => parseCsv(`ID,Process,Owner,Criticality,RPO,RTO,MTPD,Retention,Workaround,Workaround max,Applications,Description\n${rows.join('\n')}\n`);

describe('planBia', () => {
  it('changes only the non-empty cells of processes already there', () => {
    const b = planBia(sheet(['6.3.1,Repair,a-team,Critical,15 min,4h,2d,,yes,1d,shop,', '6.3.1.1,Plan,,,,,,,,,,The plan']), first, { ...opts, ...known });
    expect(b.errors).toEqual([]);
    expect(b.planned.counts).toMatchObject({ processes: 1, subprocesses: 1, changed: 2, new: 0, gone: 0 });
    expect(b.planned.changes.find(c => c.id === '6.3.1')!.what).toBe(
      'owner: group:default/unassigned → group:default/a-team; criticality: standard → critical; rpo: (none) → 15m; rto: (none) → 4h; mtpd: (none) → 48h; workaround: (none) → yes, up to 24h; applications: (none) → system:default/shop',
    );
    const repair = docOf(b.planned.files, 'repair')!;
    expect(repair.spec).toMatchObject({ owner: 'group:default/a-team', criticality: 'critical', rpo: '15m', rto: '4h', mtpd: '48h', workaround: { manual: true, maxDuration: '24h' }, dependsOn: ['system:default/shop'] });
    // the hash of the import stays: for a reimport these are portal values
    expect(repair.metadata.annotations![A.hash]).toBe(docOf(first, 'repair')!.metadata.annotations![A.hash]);
    expect(docOf(b.planned.files, 'plan')!.metadata.description).toBe('The plan');
    expect(docOf(b.planned.files, 'plan')!.spec!.criticality).toBeUndefined();
  });
  it('unknown IDs, bad values and repeated IDs are errors of their row; nothing is created', () => {
    const b = planBia(sheet(['9.9.9,Ghost,,critical,,,,,,,,', '6.3.1,Repair,nobody,high,soon,,,,maybe,,ghost-app,', '6.3.1.1,Plan,,,,,,,no,,,', '6.3.1.1,Plan,,,,,,,,,,']), first, { ...opts, ...known });
    expect(b.errors.map(e => e.row)).toEqual([2, 3, 5]);
    expect(b.errors[0].message).toBe('9.9.9 is no process of customer: the analysis only updates processes already there.');
    expect(b.errors[1].message).toBe(
      '6.3.1: the owner nobody is no group of the catalog; the criticality "high" is none of critical, important, standard; RPO "soon" is not a duration (15m, 4h, 3d, 30y); Workaround "maybe" is not yes or no; the application ghost-app is not in the catalog.',
    );
    expect(b.planned.files.map(f => f.path)).toEqual([`${DIR}/process-plan.yaml`]);
    expect(docOf(b.planned.files, 'plan')!.spec!.workaround).toEqual({ manual: false });
  });
  it('a sheet without an ID column', () => {
    expect(planBia(parseCsv('Name,RTO\nx,4h\n'), first, opts).errors[0].message).toMatch(/no column "ID"/);
  });
  it('an APQC reimport keeps what the analysis wrote, and says nothing of it', () => {
    const b = planBia(sheet(['6.3.1,Repair,a-team,critical,15m,4h,2d,,,,,']), first, { ...opts, ...known });
    const after = first.map(f => b.planned.files.find(x => x.path === f.path) ?? f);
    const again = plan(parseRows(parseCsv(APQC), { source: 'apqc' }).drafts, after, { ...opts, goneFamily: 'apqc' });
    expect(again.files).toEqual([]);
    expect(again.changes).toEqual([]);
    expect(again.counts.unchanged).toBe(4);
  });
});
