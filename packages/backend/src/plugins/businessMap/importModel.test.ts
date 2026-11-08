import { parseAllDocuments } from 'yaml';
import { A, copyDrafts, type ModelEntity, parseRows, plan, slug, supportCategories } from './importModel';
import { parseCsv } from './sheets';

// every fixture here is made up: no content of any reference model
const TEMPLATE = `ID,Parent,Title,Owner,Criticality,RPO,RTO,Retention,Applications
D1,,Keep the fleet flying,fleet-team,,,,,
D1.1,D1,Repair aircraft,,,,,,
D1.1.1,D1.1,Plan a repair,repairs,critical,15 min,4h,30y,"petstore, nowhere"
D1.1.2,D1.1,Order spare parts,ghosts,Alta,,,,
D1.2,D1,Report the fleet,,important,,,,animalshelter
D2,,Run the office,,,,,,
X9,Q7,Lost,,,,,,
`;

const APQC = `Some title line
PCF ID,Hierarchy ID,Name
10001,1.0,Invented category one
10002,1.1,Invented group
10003,1.1.1,Invented process
10004,1.1.1.1,Invented activity
10005,7.0,Invented support category
10006,7.1,Invented support group
10007,7.1.1,Invented support process
`;

const OWN = `Code;Name;Lvl;Crit
A;Sales;1;
A-1;Sell things;2;Alta
A-2;Ship things;2;Baja
B;Back office;1;
B-1;Payroll;2;
B-1-1;Pay people;3;
`;

const known = {
  knownGroups: new Set(['group:default/fleet-team', 'group:default/repairs']),
  knownEntities: new Set(['system:default/petstore', 'system:default/animalshelter']),
};

const DIR = 'catalog/business-map/example-customer';
const opts = { namespace: 'example-customer', dir: DIR, today: '2026-11-08' };
const docs = (text: string) => parseAllDocuments(text).map(d => d.toJS() as ModelEntity);
const byPath = (files: Array<{ path: string; text: string }>, p: string) => {
  const f = files.find(x => x.path === `${DIR}/${p}`);
  return f ? docs(f.text)[0] : undefined;
};

describe('slug', () => {
  it('makes names of titles', () => {
    expect(slug('Gestión de Reparación & Mantenimiento')).toBe('gestion-de-reparacion-mantenimiento');
    expect(slug('***')).toBe('item');
  });
});

describe('parseRows: the Refresquito template', () => {
  const p = parseRows(parseCsv(TEMPLATE), { source: 'template', owner: 'group:default/architects', ...known });
  it('finds errors and warnings', () => {
    expect(p.errors).toEqual([{ row: 8, message: 'X9: its parent Q7 is not in the file.' }]);
    const w = p.warnings.map(x => x.message);
    expect(w).toContain('D1.1.1: the application nowhere is not in the catalog: imported without it.');
    expect(w).toContain('D1.1.2: the owner ghosts is no group of the catalog: imported as group:default/unassigned.');
    expect(w).toContain('D1.1.2: the criticality "Alta" is none of critical, important, standard: imported as standard.');
  });
  it('makes domains, a subdomain and processes', () => {
    expect(p.drafts.map(d => `${d.kind} ${d.annotations[A.modelId]}`)).toEqual([
      'Domain D1', 'Domain D1.1', 'BusinessProcess D1.1.1', 'BusinessProcess D1.1.2', 'BusinessProcess D1.2', 'Domain D2',
    ]);
    const plan1 = p.drafts.find(d => d.annotations[A.modelId] === 'D1.1.1')!;
    const { owner, criticality, rpo, rto, retention, dependsOn } = plan1;
    expect({ owner, criticality, rpo, rto, retention, dependsOn }).toEqual({ owner: 'group:default/repairs', criticality: 'critical', rpo: '15m', rto: '4h', retention: '30y', dependsOn: ['system:default/petstore'] });
    expect(p.drafts.find(d => d.annotations[A.modelId] === 'D1.2')!.owner).toBe('group:default/architects');
  });
});

describe('parseRows: APQC layout and own layout', () => {
  it('APQC: levels 1-3 by the hierarchy ID, 4 and below left out', () => {
    const p = parseRows(parseCsv(APQC), { source: 'apqc', version: '9.9' });
    expect(p.errors).toEqual([]);
    expect(p.drafts.map(d => `${d.kind} ${d.annotations[A.pcfId]} ${d.annotations[A.pcfElementId]}`)).toEqual([
      'Domain 1.0 10001', 'Domain 1.1 10002', 'BusinessProcess 1.1.1 10003', 'Domain 7.0 10005', 'Domain 7.1 10006', 'BusinessProcess 7.1.1 10007',
    ]);
    expect(p.drafts[2].owner).toBe('group:default/unassigned');
    expect(p.drafts[2].criticality).toBe('standard');
    expect(p.warnings[0].message).toMatch(/1 rows below the level of a process/);
  });
  it('own: column mapping by header and letter, levels, value mapping', () => {
    const p = parseRows(parseCsv(OWN), {
      source: 'own',
      mapping: { id: 'Code', title: 'B', level: 'Lvl', criticality: 'crit' },
      valueMapping: { criticality: { alta: 'critical', Baja: 'standard' } },
    });
    expect(p.errors).toEqual([]);
    expect(p.drafts.map(d => `${d.kind} ${d.annotations[A.modelId]} ${d.criticality ?? ''}`.trim())).toEqual([
      'Domain A', 'BusinessProcess A-1 critical', 'BusinessProcess A-2 standard', 'Domain B', 'Domain B-1', 'BusinessProcess B-1-1 standard',
    ]);
  });
  it('own: a missing column stops it', () => {
    const p = parseRows(parseCsv(OWN), { source: 'own', mapping: { id: 'Code', title: 'Title', level: 'Lvl' } });
    expect(p.errors[0].message).toBe('There is no column "Title" (title).');
    expect(p.drafts).toEqual([]);
  });
  it('a duplicated ID is an error', () => {
    const p = parseRows(parseCsv('ID,Parent,Title\nA,,One\nA,,Two\n'), { source: 'template' });
    expect(p.errors).toEqual([{ row: 3, message: 'The ID A is also in row 2.' }]);
  });
});

describe('plan: first import', () => {
  const p = parseRows(parseCsv(TEMPLATE), { source: 'template', ...known });
  const model: ModelEntity = { apiVersion: 'refresquito.io/v1alpha1', kind: 'ReferenceModel', metadata: { name: 'example-customer-business-model' }, spec: { source: 'template', namespace: 'example-customer' } };
  const r = plan(p.drafts, [], { ...opts, goneFamily: 'model', model });
  it('one file per entity, and the reference model', () => {
    expect(r.files.map(f => f.path.replace(`${DIR}/`, '')).sort()).toEqual([
      'domain-keep-the-fleet-flying.yaml', 'domain-repair-aircraft.yaml', 'domain-run-the-office.yaml',
      'process-order-spare-parts.yaml', 'process-plan-a-repair.yaml', 'process-report-the-fleet.yaml', 'reference-model.yaml',
    ]);
    expect(r.counts).toEqual({ domains: 2, subdomains: 1, new: 6, changed: 0, gone: 0, unchanged: 0 });
    expect(r.referenceModel).toBe('referencemodel:default/example-customer-business-model');
  });
  it('writes the entities of the kinds', () => {
    const sub = byPath(r.files, 'domain-repair-aircraft.yaml')!;
    expect(sub.spec).toEqual({ type: 'business-area', owner: 'group:default/unassigned', subdomainOf: 'domain:example-customer/keep-the-fleet-flying' });
    const bp = byPath(r.files, 'process-plan-a-repair.yaml')!;
    expect(bp.apiVersion).toBe('refresquito.io/v1alpha1');
    expect(bp.metadata.namespace).toBe('example-customer');
    expect(bp.metadata.annotations![A.modelId]).toBe('D1.1.1');
    expect(bp.metadata.annotations![A.hash]).toMatch(/^title:[0-9a-f]{8},owner:/);
    expect(bp.spec).toEqual({ owner: 'group:default/repairs', domain: 'domain:example-customer/repair-aircraft', criticality: 'critical', rpo: '15m', rto: '4h', retention: '30y', dependsOn: ['system:default/petstore'] });
  });

  describe('reimport', () => {
    const current = r.files.filter(f => !f.path.endsWith('reference-model.yaml'));
    // the portal changed the owner of "Plan a repair" and added a process key; someone wrote a process by hand
    const edited = current.map(f => (f.path.endsWith('process-plan-a-repair.yaml') ? { ...f, text: f.text.replace('owner: group:default/repairs', 'owner: group:default/night-shift').replace('annotations:', 'annotations:\n    refresquito.io/process-key: repair-flow') } : f));
    edited.push({ path: `${DIR}/process-by-hand.yaml`, text: 'apiVersion: refresquito.io/v1alpha1\nkind: BusinessProcess\nmetadata: { name: by-hand, namespace: example-customer }\nspec: { owner: group:default/x, domain: run-the-office, criticality: standard }\n' });
    // the new file: the owner of D1.1.1 and the title of D1.1.2 change, D1.2 and D2 are gone, D3 is new
    const next = `ID,Parent,Title,Owner,Criticality,RPO,RTO,Retention,Applications
D1,,Keep the fleet flying,fleet-team,,,,,
D1.1,D1,Repair aircraft,,,,,,
D1.1.1,D1.1,Plan a repair,fleet-team,critical,15 min,4h,30y,petstore
D1.1.2,D1.1,Order spare parts fast,ghosts,Alta,,,,
D3,,Plan a repair,,,,,,
`;
    const again = plan(parseRows(parseCsv(next), { source: 'template', ...known }).drafts, edited, { ...opts, goneFamily: 'model' });
    it('keeps the portal edit, applies the file, marks the gone ones', () => {
      expect(again.counts).toEqual({ domains: 2, subdomains: 1, new: 1, changed: 1, gone: 2, unchanged: 2 });
      // rewritten for its new hash, with the owner of the portal and its process key
      const bp = byPath(again.files, 'process-plan-a-repair.yaml')!;
      expect(bp.spec!.owner).toBe('group:default/night-shift');
      expect(bp.metadata.annotations!['refresquito.io/process-key']).toBe('repair-flow');
      expect(again.changes.filter(c => c.id === 'D1.1.1')).toEqual([
        { kind: 'review', id: 'D1.1.1', title: 'Plan a repair', what: 'owner edited in the portal: kept group:default/night-shift (the file says group:default/fleet-team)' },
      ]);
      expect(byPath(again.files, 'process-order-spare-parts.yaml')!.metadata.title).toBe('Order spare parts fast');
      expect(byPath(again.files, 'domain-run-the-office.yaml')!.metadata.annotations![A.deprecated]).toBe('2026-11-08');
      expect(byPath(again.files, 'process-report-the-fleet.yaml')!.metadata.annotations![A.deprecated]).toBe('2026-11-08');
      expect(byPath(again.files, 'process-by-hand.yaml')).toBeUndefined();
      // a new name never takes one in use
      expect(byPath(again.files, 'domain-plan-a-repair-2.yaml')!.metadata.annotations![A.modelId]).toBe('D3');
    });
  });
});

describe('copyDrafts (adopt, keep support categories)', () => {
  const ns = 'reference-x';
  const e = (kind: string, name: string, id: string, spec: Record<string, unknown>): ModelEntity => ({
    apiVersion: kind === 'Domain' ? 'backstage.io/v1alpha1' : 'refresquito.io/v1alpha1',
    kind,
    metadata: { name, namespace: ns, title: name, annotations: { [A.pcfId]: id, [A.pcfVersion]: '9.9' } },
    spec,
  });
  const model = [
    e('Domain', 'one', '1.0', { owner: 'group:default/unassigned' }),
    e('Domain', 'one-group', '1.1', { owner: 'group:default/unassigned', subdomainOf: 'one' }),
    e('BusinessProcess', 'one-process', '1.1.1', { owner: 'group:default/unassigned', domain: 'one-group', criticality: 'standard' }),
    e('Domain', 'support', '7.0', { owner: 'group:default/unassigned' }),
    e('BusinessProcess', 'support-process', '7.0.1', { owner: 'group:default/unassigned', domain: `domain:${ns}/support`, criticality: 'standard' }),
  ];
  it('copies the chosen categories into the namespace, keeping the PCF ID', () => {
    const drafts = copyDrafts(model, ['1.0'], { owner: 'group:default/fleet-team', from: 'referencemodel:default/x' });
    expect(drafts.map(d => d.key)).toEqual(['apqc:1', 'apqc:1.1', 'apqc:1.1.1']);
    const r = plan(drafts, [], opts);
    const bp = byPath(r.files, 'process-one-process.yaml')!;
    expect(bp.metadata.annotations![A.pcfId]).toBe('1.1.1');
    expect(bp.metadata.annotations![A.adoptedFrom]).toBe('referencemodel:default/x');
    expect(bp.spec!.owner).toBe('group:default/fleet-team');
    expect(bp.spec!.domain).toBe('domain:example-customer/one-group');
  });
  it('the support categories of an APQC model are those from 7 on', () => {
    const m: ModelEntity = { apiVersion: 'refresquito.io/v1alpha1', kind: 'ReferenceModel', metadata: { name: 'x' }, spec: { source: 'apqc', namespace: ns } };
    expect(supportCategories(m, model)).toEqual(['7.0']);
    expect(copyDrafts(model, supportCategories(m, model), { from: 'referencemodel:default/x' }).map(d => d.kind)).toEqual(['Domain', 'BusinessProcess']);
  });
});
