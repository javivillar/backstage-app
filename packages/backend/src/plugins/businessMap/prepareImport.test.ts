import { ConfigReader } from '@backstage/config';
import { currentFiles, InputError, readImportInput } from './prepareImport';

const FILE = `data:text/csv;name=model.csv;base64,${Buffer.from('ID,Title\nD1,One\n').toString('base64')}`;

describe('readImportInput', () => {
  it('reads what the form field sends, leaving out the empty values', () => {
    expect(
      readImportInput({
        source: 'own',
        file: FILE,
        sheet: '',
        namespace: 'example-customer',
        owner: '',
        mapping: { id: 'A', title: 'B', parent: '' },
        valueMapping: { criticality: { Alta: 'critical' } },
        keepFrom: undefined,
        industry: '',
        version: null,
      }),
    ).toEqual({
      source: 'own',
      file: FILE,
      fileName: undefined,
      sheet: undefined,
      namespace: 'example-customer',
      owner: undefined,
      mapping: { id: 'A', title: 'B' },
      valueMapping: { criticality: { Alta: 'critical' } },
      keepFrom: undefined,
      industry: undefined,
      version: undefined,
    });
  });

  it('keeps a sheet given by number and the version', () => {
    const i = readImportInput({ source: 'apqc', file: FILE, namespace: 'example-customer', sheet: 2, version: '7.4', industry: 'aerospace-defense' });
    expect(i.sheet).toBe(2);
    expect(i.version).toBe('7.4');
    expect(i.mapping).toBeUndefined();
    expect(i.valueMapping).toBeUndefined();
  });

  it('refuses a bad body', () => {
    expect(() => readImportInput({ source: 'xls', file: FILE, namespace: 'a' })).toThrow(InputError);
    expect(() => readImportInput({ source: 'template', namespace: 'abc' })).toThrow(/file/);
    expect(() => readImportInput({ source: 'template', file: FILE, namespace: 'Bad NS' })).toThrow(/namespace/);
    expect(() => readImportInput({ source: 'own', file: FILE, namespace: 'abc', mapping: ['A'] })).toThrow(/mapping/);
    expect(() => readImportInput({ source: 'own', file: FILE, namespace: 'abc', mapping: { id: 3 } })).toThrow(/mapping.id/);
    expect(() => readImportInput({ source: 'own', file: FILE, namespace: 'abc', valueMapping: 'x' })).toThrow(/valueMapping/);
    expect(() => readImportInput({ source: 'own', file: FILE, namespace: 'abc', owner: 7 })).toThrow(/owner/);
  });
});

describe('currentFiles', () => {
  const config = new ConfigReader({});
  const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    (async () => new Response(JSON.stringify(body), { status, headers })) as unknown as typeof fetch;
  it('reads the whole folder in one GraphQL query', async () => {
    const fetchFn = answer(200, { data: { repository: { object: { entries: [
      { name: 'domain-a.yaml', type: 'blob', object: { text: 'kind: Domain\n', isTruncated: false } },
      { name: 'README.md', type: 'blob', object: { text: '#', isTruncated: false } },
    ] } } } });
    expect(await currentFiles(config, 'acme', fetchFn)).toEqual([{ path: 'catalog/business-map/acme/domain-a.yaml', text: 'kind: Domain\n' }]);
  });
  it('is a first import when the folder is not there', async () => {
    expect(await currentFiles(config, 'acme', answer(200, { data: { repository: { object: null } } }))).toEqual([]);
  });
  it('says when to try again when GitHub limits the token', async () => {
    const fetchFn = answer(403, { message: 'rate limit' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1794150000' });
    await expect(currentFiles(config, 'acme', fetchFn)).rejects.toThrow('try again after');
  });
});
