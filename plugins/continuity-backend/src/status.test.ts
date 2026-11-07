import { buildSummary, computeProfile, flattenAnchors } from './status';
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
const active = { id: 'r', kind: 'record', export: { status: 'active' } };
const planned = { id: 'p', kind: 'record', export: { status: 'planned' } };

describe('computeProfile', () => {
  it('is ok when every record has an active export and the profile is approved', () => {
    const c = computeProfile(base({ records: [active, { id: 'd', kind: 'definitions' }], trustAnchors: [{ id: 'a', kind: 'ca', offlineCopy: 'yes' }] }));
    expect(c).toMatchObject({ state: 'ok', stateReason: 'ok', recordsTotal: 1, recordsWithoutActiveExport: 0, reasons: [] });
  });

  it('warns on a record without an active export (missing or planned)', () => {
    const c = computeProfile(base({ records: [active, planned, { id: 'm', kind: 'record' }] }));
    expect(c).toMatchObject({ state: 'warning', stateReason: 'record-no-export', recordsWithoutActiveExport: 2 });
  });

  it('is critical when an external service keeps records without an active export', () => {
    const c = computeProfile(base({ service: 'github', lifecycle: 'external', records: [planned] }));
    expect(c.state).toBe('critical');
    expect(c.reasons[0]).toMatchObject({ key: 'external-no-export', title: 'github: knowledge only outside the zone' });
  });

  it('is critical when a trust anchor has no offline copy, and warns when it is unknown', () => {
    expect(computeProfile(base({ trustAnchors: [{ id: 'cosign', title: 'cosign key', kind: 'signing-key', offlineCopy: 'no' }] })).reasons[0]).toMatchObject({
      level: 'critical',
      key: 'anchor-no-offline',
      title: 's: cosign key without offline copy',
    });
    expect(computeProfile(base({ trustAnchors: [{ id: 'k', kind: 'ca', offlineCopy: 'unknown' }] })).stateReason).toBe('anchor-offline-unknown');
    expect(computeProfile(base({ trustAnchors: [{ id: 'k', kind: 'passphrase', offlineCopy: 'n/a' }] })).state).toBe('ok');
  });

  it('warns on a deprecated service, with what replaces it, and on a draft', () => {
    const c = computeProfile(base({ service: 'bpm-oneke', lifecycle: 'deprecated', replacedBy: 'operaton-oneke', status: 'draft' }));
    expect(c.reasons.map(r => r.key)).toEqual(['deprecated-replaced', 'draft']);
    expect(c.reasons[0].title).toBe('bpm-oneke deprecated, replaced by operaton-oneke');
  });

  it('warns on a live certificate with less than 90 days left', () => {
    const anchor: FlatAnchor = { id: 'ca', kind: 'ca', offlineCopy: 'yes', service: 's', live: { notAfter: '2027-01-01T00:00:00.000Z', notBefore: '', subject: 'CN=x', daysLeft: 30 } };
    const p = base({ trustAnchors: [anchor] });
    expect(computeProfile(p, [anchor]).stateReason).toBe('cert-expiring');
    expect(computeProfile(p, [{ ...anchor, live: { ...anchor.live!, daysLeft: 400 } }]).state).toBe('ok');
  });

  it('puts the critical reasons first', () => {
    const c = computeProfile(base({ status: 'draft', trustAnchors: [{ id: 'k', kind: 'ca', offlineCopy: 'no' }] }));
    expect(c.reasons.map(r => r.level)).toEqual(['critical', 'warning']);
    expect(c.state).toBe('critical');
  });
});

describe('buildSummary', () => {
  it('counts and lists what needs attention, critical first', () => {
    const profiles = [
      base({ service: 'bpm-oneke', lifecycle: 'deprecated', replacedBy: 'operaton-oneke' }),
      base({ service: 'harbor', lifecycle: 'external', status: 'draft', trustAnchors: [{ id: 'cosign', kind: 'signing-key', offlineCopy: 'no' }] }),
      base({ service: 'pki-oneke', records: [active], trustAnchors: [{ id: 'root', kind: 'ca', offlineCopy: 'unknown' }] }),
    ];
    const anchors = flattenAnchors(profiles, (service, id) => (id === 'root' ? { liveError: 'no bundle' } : {}));
    const s = buildSummary(profiles, anchors, ['w']);
    expect(s.attention.map(a => `${a.level} ${a.service} ${a.key}`)).toEqual([
      'critical harbor anchor-no-offline',
      'warning bpm-oneke deprecated-replaced',
      'warning harbor draft',
      'warning pki-oneke anchor-offline-unknown',
    ]);
    expect(s.trustAnchors.map(a => [a.service, a.id, a.liveError])).toEqual([
      ['harbor', 'cosign', undefined],
      ['pki-oneke', 'root', 'no bundle'],
    ]);
    expect(s.counts).toMatchObject({ services: 3, approved: 2, draft: 1, recordsTotal: 1, recordsWithoutActiveExport: 0, trustAnchors: 2, anchorsWithoutOfflineCopy: 2, deprecated: 1, external: 1, critical: 1, warning: 2, ok: 0 });
    expect(s.warnings).toEqual(['w']);
  });
});
