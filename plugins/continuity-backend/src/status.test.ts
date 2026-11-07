import { buildSummary, ceremonyOf, computeProfile, flattenAnchors, isExportActive } from './status';
import type { FlatAnchor, Profile } from './types';

const base = (p: Partial<Profile>): Profile & { file: string } => ({
  service: 's',
  lifecycle: 'supported',
  status: 'approved',
  records: [],
  trustAnchors: [],
  file: 's.yaml',
  ...p,
});
const rec = { id: 'r', kind: 'record', export: { format: 'JSONL', workflow: 'continuity-export-x' } };

describe('zone state (phase L1)', () => {
  it('has no active export and no recorded ceremony yet', () => {
    expect(isExportActive(rec)).toBe(false);
    expect(ceremonyOf({ id: 'a', kind: 'ca' })).toBe('unrecorded');
  });
});

describe('computeProfile', () => {
  it('is ok without records of kind record, approved and supported', () => {
    const c = computeProfile(base({ records: [{ id: 'd', kind: 'definitions' }], trustAnchors: [{ id: 'a', kind: 'ca' }] }));
    expect(c).toMatchObject({ state: 'ok', stateReason: 'ok', recordsTotal: 0, recordsWithoutActiveExport: 0, reasons: [], installed: true, external: false });
    expect(c.records[0].exportActive).toBe(false);
  });

  it('warns on every record: none has an active export in this zone yet', () => {
    const c = computeProfile(base({ records: [rec, { id: 'm', kind: 'record' }] }));
    expect(c).toMatchObject({ state: 'warning', stateReason: 'record-no-export', recordsTotal: 2, recordsWithoutActiveExport: 2 });
  });

  it('is critical when an external service keeps records (knowledge and evidence only outside the zone)', () => {
    const c = computeProfile(base({ service: 'github', lifecycle: 'external', records: [rec] }), [], { installed: false });
    expect(c).toMatchObject({ state: 'critical', installed: true, external: true });
    expect(c.reasons[0]).toMatchObject({ key: 'external-no-export', title: 'github: knowledge and evidence only outside the zone' });
  });

  it('warns on a deprecated service, with what replaces it, and on a draft', () => {
    const c = computeProfile(base({ service: 'bpm-oneke', lifecycle: 'deprecated', replacedBy: 'operaton-oneke', status: 'draft' }));
    expect(c.reasons.map(r => r.key)).toEqual(['deprecated-replaced', 'draft']);
    expect(c.reasons[0].title).toBe('bpm-oneke deprecated, replaced by operaton-oneke');
  });

  it('warns on a live certificate with less than 90 days left, not on its unrecorded ceremony', () => {
    const anchor: FlatAnchor = { id: 'ca', kind: 'ca', service: 's', ceremony: 'unrecorded', live: { notAfter: '2027-01-01T00:00:00.000Z', notBefore: '', subject: 'CN=x', daysLeft: 30 } };
    const p = base({ trustAnchors: [anchor] });
    expect(computeProfile(p, [anchor]).stateReason).toBe('cert-expiring');
    expect(computeProfile(p, [{ ...anchor, live: { ...anchor.live!, daysLeft: 400 } }]).state).toBe('ok');
  });

  it('marks a profile not installed', () => {
    expect(computeProfile(base({}), [], { installed: false }).installed).toBe(false);
  });
});

describe('buildSummary', () => {
  const profiles = [
    base({ service: 'bpm-oneke', lifecycle: 'deprecated', replacedBy: 'operaton-oneke' }),
    base({ service: 'github', lifecycle: 'external', records: [rec] }),
    base({ service: 'harbor', lifecycle: 'external', status: 'draft', trustAnchors: [{ id: 'cosign', kind: 'signing-key' }] }),
    base({ service: 'pki-oneke', records: [rec], trustAnchors: [{ id: 'root', kind: 'ca' }] }),
    base({ service: 'gone-oneke', title: 'Gone', tier: 'C', records: [rec], trustAnchors: [{ id: 'k', kind: 'passphrase' }] }),
  ];
  const anchors = flattenAnchors(profiles, (_s, id) => (id === 'root' ? { liveError: 'no bundle' } : {}));

  it('counts only what is installed (and the externals), and lists the rest apart', () => {
    const s = buildSummary(profiles, anchors, ['w'], new Set(['bpm-oneke', 'pki-oneke', 'cnoe-oneke']));
    expect(s.profiles.map(p => p.service)).toEqual(['bpm-oneke', 'github', 'harbor', 'pki-oneke']);
    expect(s.notInstalled).toEqual([{ service: 'gone-oneke', title: 'Gone', tier: 'C' }]);
    expect(s.trustAnchors.map(a => [a.service, a.id, a.ceremony, a.liveError])).toEqual([
      ['harbor', 'cosign', 'unrecorded', undefined],
      ['pki-oneke', 'root', 'unrecorded', 'no bundle'],
    ]);
    expect(s.attention.map(a => `${a.level} ${a.service} ${a.key}`)).toEqual([
      'critical github external-no-export',
      'warning  drafts',
      'warning  ceremonies-unrecorded',
      'warning bpm-oneke deprecated-replaced',
      'warning pki-oneke record-no-export',
    ]);
    expect(s.attention[2].vars).toEqual({ n: 2 });
    expect(s.counts).toMatchObject({ services: 4, approved: 3, draft: 1, recordsTotal: 2, recordsWithoutActiveExport: 2, trustAnchors: 2, anchorsUnrecorded: 2, deprecated: 1, external: 2, notInstalled: 1, critical: 1, warning: 3, ok: 0 });
    expect(s.warnings).toEqual(['w']);
  });

  it('counts everything as installed when the catalog is unknown', () => {
    expect(buildSummary(profiles, anchors).notInstalled).toEqual([]);
  });

  it('aggregates the records without an active export above 5 services', () => {
    const many = Array.from({ length: 6 }, (_, i) => base({ service: `s${i}`, records: [rec] }));
    const s = buildSummary(many, []);
    expect(s.attention).toEqual([
      expect.objectContaining({ level: 'warning', service: '', key: 'exports-missing', vars: { n: 6, services: 's0, s1, s2, s3, s4, s5' } }),
    ]);
    expect(buildSummary(many.slice(0, 5), []).attention.map(a => a.key)).toEqual(Array(5).fill('record-no-export'));
  });
});
