import { foldersOf } from './FoldersAccess';

describe('foldersOf', () => {
  it('pairs the editors and viewers groups of each folder, applications first', () => {
    const rows = foldersOf(
      [
        { name: 'grafana-iam-viewers', members: ['vera'] },
        { name: 'grafana-petstore-editors', members: ['javi', 'ana'] },
        { name: 'grafana-iam-editors', members: [] },
        { name: 'backstage-admin', members: ['javi'] },
        { name: 'grafana-petstore-viewers', members: [] },
      ],
      new Set(['petstore']),
    );
    expect(rows).toEqual([
      { name: 'petstore', kind: 'applications', editors: ['javi', 'ana'], viewers: [] },
      { name: 'iam', kind: 'services', editors: [], viewers: ['vera'] },
    ]);
  });

  it('keeps a folder with only one of its groups', () => {
    expect(foldersOf([{ name: 'grafana-dfir-iris-viewers', members: [] }], new Set())).toEqual([{ name: 'dfir-iris', kind: 'services', viewers: [] }]);
  });
});
