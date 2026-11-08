import { CATALOG, MAP, NOW } from './fixture';
import { businessGraph } from './glassModel';
import { buildMatrix, exerciseBody, whatIf } from './matrixModel';

const g = businessGraph(MAP, CATALOG, () => ({ tone: 'ok', label: 'Healthy' }));
const m = buildMatrix(g, MAP, NOW);
const proc = (n: string) => `businessprocess:occar/${n}`;
const comp = (n: string) => `component:default/${n}`;

describe('matrixModel', () => {
  it('has the platform services, then the framework lines, as columns', () => {
    expect(m.columns.map(c => [c.label, c.family])).toEqual([
      ['iam-oneke', 'platform'],
      ['seaweedfs-oneke', 'platform'],
      ['python-framework-2-0', 'development'],
      ['python-framework-3-2', 'development'],
      ['python-framework-3-3', 'development'],
    ]);
    expect(m.columns[0]).toEqual({ id: comp('iam-oneke'), label: 'iam-oneke', family: 'platform', tier: 'gold', rpo: 15, rto: 60 });
  });

  it('checks each process against the services it depends on', () => {
    const repair = m.groups[0].rows.find(r => r.ref === proc('repair'))!;
    expect(repair.cells.get(comp('seaweedfs-oneke'))).toEqual({ family: 'platform', check: 'rpo' });
    expect(repair.cells.get(comp('python-framework-3-2'))).toEqual({ family: 'development', support: 'ending' });
    expect(repair.cells.has(comp('iam-oneke'))).toBe(false);
    expect(m.footer.get(comp('iam-oneke'))).toEqual({ deps: 2, gaps: 0 });
    expect(m.footer.get(comp('seaweedfs-oneke'))).toEqual({ deps: 1, gaps: 1 });
    expect(m.footer.get(comp('python-framework-2-0'))).toEqual({ deps: 1, gaps: 1 });
    expect(m.groups.map(x => x.rows.length)).toEqual([2, 2]);
  });

  it('rehearses a failure: what stops, the restore time and the margins', () => {
    const w = whatIf(g, m, [comp('iam-oneke')]);
    expect(w.stopped.map(p => p.title)).toEqual(['Manage spare parts', 'Grant access']);
    expect(w.critical).toBe(1);
    expect(w.restore).toBe(60);
    expect(w.applications).toEqual(['logistics', 'personnel']);
    expect(w.domains).toEqual(['Service after sales', 'Information technology']);
    expect(w.margins.map(x => [x.title, x.margin, x.verdict])).toEqual([
      ['Grant access', 0, 'no-margin'],
      ['Manage spare parts', 1380, 'spare'],
    ]);
  });

  it('takes the longest RTO of the failed services and marks the breaches', () => {
    const w = whatIf(g, m, [comp('iam-oneke'), comp('seaweedfs-oneke')]);
    expect(w.restore).toBe(240);
    expect(w.margins[0]).toEqual({ ref: proc('access'), title: 'Grant access', criticality: 'critical', rto: 60, margin: -180, verdict: 'breach' });
    expect(whatIf(g, m, []).stopped).toEqual([]);
    expect(whatIf(g, m, [comp('python-framework-3-2')]).stopped).toEqual([]);
  });

  it('builds the body of an exercise', () => {
    const w = whatIf(g, m, [comp('seaweedfs-oneke')]);
    expect(exerciseBody('occar', w, '  first drill ')).toEqual({
      namespace: 'occar',
      failed: [comp('seaweedfs-oneke')],
      processes: [{ ref: proc('repair'), result: 'no-margin', marginMinutes: 0 }],
      note: 'first drill',
    });
    expect(exerciseBody('occar', w, ' ').note).toBeUndefined();
  });
});
