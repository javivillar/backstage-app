import { applyChange, ChangeError, handlerFor, lineDiff, type ChangeRequest } from './manageModel';

const FILE = `# Petshop — the example application
name: petshop
title: "Pet Shop"
# what it uses of the platform
platform:
  s3:
    enabled: true
    buckets: [files]
  dms:
    enabled: true
    sites:
      - { name: documents, users: ["javi"] }
`;

const req = (over: Partial<ChangeRequest>): ChangeRequest => ({
  service: 'seaweedfs',
  object: 'bucket',
  action: 'create',
  owner: { kind: 'application', name: 'petshop' },
  ...over,
});

const run = (r: ChangeRequest, text = FILE) => applyChange(text, handlerFor(r.service, r.object), r);
const fails = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e as ChangeError;
  }
  throw new Error('it did not fail');
};

describe('Manage through git: the edit of an application file', () => {
  it('adds a bucket and keeps the comments and the rest of the file', () => {
    const { text, summary } = run(req({ spec: { name: 'evidence' } }));
    expect(text).toContain('# what it uses of the platform');
    expect(text).toMatch(/buckets: \[ files, evidence \]|buckets:\s*\[files, evidence\]/);
    expect(text).toContain('name: documents');
    expect(summary).toBe('Add S3 bucket evidence of petshop');
  });

  it('refuses a bucket that exists, a bad name and an unknown object', () => {
    expect(fails(() => run(req({ spec: { name: 'files' } }))).status).toBe(409);
    expect(fails(() => run(req({ spec: { name: 'Files!' } }))).status).toBe(422);
    expect(fails(() => handlerFor('gravitee', 'api')).status).toBe(501);
    expect(handlerFor('seaweedfs', 'bucket').target({ kind: 'platform' }).path).toBe('bootstrap/app-of-apps/platform/seaweedfs.yaml');
    expect(handlerFor('alfresco', 'site').target({ kind: 'platform' }).path).toBe('bootstrap/app-of-apps/platform/alfrescodms.yaml');
    expect(handlerFor('seaweedfs', 'bucket').target({ kind: 'application', name: 'petshop' }).path).toBe('bootstrap/app-of-apps/apps/petshop.yaml');
  });

  it('deletes with a tombstone the provisioner removes, and a create revives it', () => {
    const gone = run(req({ action: 'delete', id: 'files' })).text;
    expect(gone).toMatch(/name: files[\s\S]*state: absent/);
    expect(fails(() => run(req({ action: 'delete', id: 'files' }), gone)).status).toBe(404);
    const back = run(req({ spec: { name: 'files' } }), gone).text;
    expect(back).not.toContain('absent');
  });

  it('adds the block, or turns it on, without touching the rest of the file', () => {
    expect(run(req({ spec: { name: 'files' } }), 'name: tiny\n').text).toBe('name: tiny\nplatform:\n  s3:\n    enabled: true\n    buckets: [files]\n');
    const other = '# x\nname: x\nplatform:\n  sso:\n    enabled: true   # its login\n';
    expect(run(req({ spec: { name: 'files' } }), other).text).toBe(`${other}  s3:\n    enabled: true\n    buckets: [files]\n`);
    const off = 'name: x\nplatform:\n  s3:\n    enabled: false\n    buckets: [a]\n';
    expect(run(req({ spec: { name: 'bbb' } }), off).text).toBe('name: x\nplatform:\n  s3:\n    enabled: true\n    buckets: [a, bbb]\n');
    expect(fails(() => run(req({ spec: { name: 'b' } }), off)).errors[0]).toMatch(/3 to 30/);
  });

  it('changes only the lines of the change', () => {
    const { text } = run(req({ spec: { name: 'evidence' } }));
    const changed = text.split('\n').filter((l, i) => l !== FILE.split('\n')[i]);
    expect(changed).toEqual(['    buckets: [files, evidence]']);
  });

  it('adds, changes and removes a document site', () => {
    const site = (over: Partial<ChangeRequest>) => req({ service: 'alfresco', object: 'site', ...over });
    const added = run(site({ spec: { name: 'contracts', users: ['ana'], groups: ['legal'] } })).text;
    expect(added).toMatch(/name: contracts[\s\S]*ana[\s\S]*legal/);
    const changed = run(site({ action: 'update', id: 'documents', spec: { users: ['javi', 'ana'] } })).text;
    expect(changed).toMatch(/name: documents[\s\S]*javi[\s\S]*ana/);
    expect(fails(() => run(site({ action: 'update', id: 'documents', spec: { users: 'ana' } }))).errors[0]).toMatch(/users/);
    expect(run(site({ action: 'delete', id: 'documents' })).text).toMatch(/name: documents[\s\S]*state: absent/);
  });

  it('keeps the objects of the platform in manage: of the platform file, which the first one creates', () => {
    const plat = (over: Partial<ChangeRequest>) => req({ owner: { kind: 'platform' }, ...over });
    const first = run(plat({ spec: { name: 'shared', writeGroup: 's3-shared-writers' } }), '').text;
    expect(first.split('\n')[0]).toMatch(/^# Objects of the platform/);
    expect(first).toMatch(/manage:\n\s+buckets:\n\s+- name: shared\n\s+writeGroup: s3-shared-writers/);
    const second = run(plat({ spec: { name: 'other' } }), first).text;
    expect(second).toContain(first.trimEnd());
    expect(second).toMatch(/name: other/);
    expect(run(plat({ action: 'delete', id: 'shared' }), second).text).toMatch(/name: shared, state: absent/);
  });

  it('shows the change as a diff', () => {
    expect(lineDiff('a\nb\nc\n', 'a\nB\nc\n')).toBe('  a\n- b\n+ B\n  c\n  ');
  });
});
