import * as path from 'path';
import { isProfileFile, loadProfiles, parseProfile, ProfilesUnavailableError } from './profiles';

const DIR = path.join(__dirname, '__fixtures__', 'profiles');

describe('parseProfile', () => {
  it('reads records, trust anchors and the exit plan', () => {
    const w: string[] = [];
    const p = parseProfile(
      `service: iam-oneke
tier: A
lifecycle: supported
status: draft
records:
  - { id: events, kind: record, export: { format: JSONL, status: planned }, worm: true }
trustAnchors:
  - { id: k, kind: realm-keys, offlineCopy: unknown, custodians: 2 }
exit: { alternative: OIDC, upstream: { project: Keycloak, license: Apache-2.0 } }
`,
      'iam-oneke.yaml',
      w,
    );
    expect(w).toEqual([]);
    expect(p.records[0]).toMatchObject({ id: 'events', kind: 'record', worm: true, export: { format: 'JSONL', status: 'planned' } });
    expect(p.trustAnchors[0]).toMatchObject({ id: 'k', offlineCopy: 'unknown', custodians: 2 });
    expect(p.exit?.upstream).toEqual({ project: 'Keycloak', license: 'Apache-2.0' });
  });

  it('warns on values outside the schema and on a file named after another service', () => {
    const w: string[] = [];
    const p = parseProfile('service: a\nlifecycle: gone\nrecords: [{ id: r, kind: blob }]\n', 'b.yaml', w);
    expect(p.lifecycle).toBe('gone');
    expect(w).toHaveLength(3);
  });

  it('takes yes/no booleans of a YAML 1.1 writer as offline copies', () => {
    const p = parseProfile('service: a\ntrustAnchors: [{ id: x, offlineCopy: true }, { id: y, offlineCopy: false }]\n', 'a.yaml');
    expect(p.trustAnchors.map(a => a.offlineCopy)).toEqual(['yes', 'no']);
  });

  it('defaults a profile without lifecycle or status to supported and draft', () => {
    expect(parseProfile('service: a\n', 'a.yaml')).toMatchObject({ lifecycle: 'supported', status: 'draft', records: [], trustAnchors: [] });
  });

  it('refuses a file without service', () => {
    expect(() => parseProfile('title: x\n', 'x.yaml')).toThrow(/no service/);
  });
});

describe('loadProfiles', () => {
  it('reads every profile of the directory, sorted, and turns a broken file into a warning', async () => {
    const { profiles, warnings } = await loadProfiles(DIR);
    expect(profiles.map(p => p.service)).toEqual(['bpm-oneke', 'github', 'harbor', 'iam-oneke', 'pki-oneke']);
    expect(warnings).toEqual(['broken.yaml: no service']);
  });

  it('says the directory is unavailable when it does not exist', async () => {
    await expect(loadProfiles(path.join(DIR, 'missing'))).rejects.toBeInstanceOf(ProfilesUnavailableError);
  });

  it('skips the hidden entries of a ConfigMap volume', () => {
    expect(['..data', '..2026_11_07', 'a.yaml', 'b.yml', 'c.json'].filter(isProfileFile)).toEqual(['a.yaml', 'b.yml']);
  });
});
