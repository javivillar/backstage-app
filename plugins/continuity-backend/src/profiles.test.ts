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
approvedBy: continuity-officer
approvedAt: 2026-11-07
records:
  - { id: events, kind: record, export: { format: JSONL, workflow: continuity-export-keycloak }, worm: true }
trustAnchors:
  - { id: k, kind: realm-keys, probe: "keycloak:realm-keys" }
exit: { alternative: OIDC, upstream: { project: Keycloak, license: Apache-2.0 } }
`,
      'iam-oneke.yaml',
      w,
    );
    expect(w).toEqual([]);
    expect(p).toMatchObject({ approvedBy: 'continuity-officer', approvedAt: '2026-11-07' });
    expect(p.records[0]).toMatchObject({ id: 'events', kind: 'record', worm: true, export: { format: 'JSONL', workflow: 'continuity-export-keycloak' } });
    expect(p.trustAnchors[0]).toEqual({ id: 'k', title: undefined, kind: 'realm-keys', probe: 'keycloak:realm-keys', notes: undefined });
    expect(p.exit?.upstream).toEqual({ project: 'Keycloak', license: 'Apache-2.0' });
  });

  it('warns on values outside the schema and on a file named after another service', () => {
    const w: string[] = [];
    const p = parseProfile('service: a\nlifecycle: gone\nrecords: [{ id: r, kind: blob }]\n', 'b.yaml', w);
    expect(p.lifecycle).toBe('gone');
    expect(w).toHaveLength(3);
  });

  it('reads a profile of continuity-oneke 0.1.0, ignoring its facts of one zone with one warning', () => {
    const w: string[] = [];
    const p = parseProfile(
      'service: a\nrecords: [{ id: r, export: { format: X, status: active } }]\ntrustAnchors: [{ id: x, offlineCopy: no, custodians: 2, lastCeremony: 2026-01-01 }]\n',
      'a.yaml',
      w,
    );
    expect(p.records[0].export).toEqual({ method: undefined, format: 'X', schedule: undefined, workflow: undefined });
    expect(p.trustAnchors[0]).not.toHaveProperty('offlineCopy');
    expect(w).toEqual(['a.yaml: ignored records[].export.status, trustAnchors[].offlineCopy, trustAnchors[].custodians, trustAnchors[].lastCeremony (facts of one zone, not in the profile since continuity-oneke 0.1.1)']);
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
    expect(warnings).toEqual([
      'broken.yaml: no service',
      expect.stringMatching(/^harbor.yaml: ignored trustAnchors\[\]\.offlineCopy/),
      expect.stringMatching(/^iam-oneke.yaml: ignored records\[\]\.export\.status, trustAnchors\[\]\.offlineCopy/),
    ]);
  });

  it('says the directory is unavailable when it does not exist', async () => {
    await expect(loadProfiles(path.join(DIR, 'missing'))).rejects.toBeInstanceOf(ProfilesUnavailableError);
  });

  it('skips the hidden entries of a ConfigMap volume', () => {
    expect(['..data', '..2026_11_07', 'a.yaml', 'b.yml', 'c.json'].filter(isProfileFile)).toEqual(['a.yaml', 'b.yml']);
  });
});
