import { csv, findingLink, ofKind, reportCsv, type Activity, type Report } from './evidence';

describe('control and evidence in the console', () => {
  it('sends a finding to Access administration on its product', () => {
    expect(findingLink({ kind: 'single-admin', tone: 'bad', subject: 'operaton-oneke', count: 1, names: ['ana'], product: 'operaton-oneke' })).toBe('/console/access-administration?product=operaton-oneke');
    expect(findingLink({ kind: 'empty', tone: 'warn', count: 3, names: [] })).toBe('/console/access-administration');
  });

  it('filters the activity by kind', () => {
    const a = (kind: Activity['kind']): Activity => ({ at: '2026-11-12T10:00:00Z', who: 'ana', kind, action: 'add', username: 'eva', group: 'g', component: 'c' });
    const all = [a('access'), a('refused'), a('access')];
    expect(ofKind(all, 'all')).toHaveLength(3);
    expect(ofKind(all, 'access')).toHaveLength(2);
    expect(ofKind(all, 'approval')).toEqual([]);
  });

  it('writes CSV a spreadsheet reads as text', () => {
    expect(csv(['a', 'b'], [['x, y', 'say "hi"'], ['=SUM(A1)', 2]])).toBe('a,b\r\n"x, y","say ""hi"""\r\n\'=SUM(A1),2');
  });

  it('exports the report with what it is a report of', () => {
    const report: Report = {
      of: { at: '2026-11-12T02:10:00.000Z', live: false, id: 7, digest: 'abc', signature: 'def', state: 'ok' },
      rows: [{ component: 'seaweedfs-oneke', group: 's3-admins', members: ['luis', 'rosa'] }],
      people: [{ username: 'luis', groups: ['s3-admins'] }],
      snapshots: [],
      kept: true,
      signs: true,
    };
    expect(reportCsv(report, 'product')).toBe('product,group,people,members\r\nseaweedfs-oneke,s3-admins,2,luis rosa\r\n\r\naccess as of,2026-11-12T02:10:00.000Z\r\nsha256,abc\r\nsignature,def\r\n');
    expect(reportCsv({ ...report, of: { at: 'now', live: true } }, 'person')).toBe('person,groups held,groups\r\nluis,1,s3-admins\r\n\r\naccess as of,now\r\n');
  });
});
