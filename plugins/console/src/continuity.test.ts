import { atRisk, expiryDay, exportLine, label, profileFileUrl, reasonDetail, reasonText } from './continuity';
import { MESSAGES, translate } from './i18n';

const es = (k: string, v?: Record<string, string | number>) => translate('es', k, v);
const has = (k: string) => k in MESSAGES;

describe('continuity page helpers', () => {
  it('translates a reason by its key, with the service and its vars', () => {
    const r = { level: 'warning' as const, key: 'deprecated-replaced', title: 'bpm-oneke deprecated, replaced by operaton-oneke', detail: '', vars: { replacedBy: 'operaton-oneke' }, service: 'bpm-oneke' };
    expect(reasonText(r, es, has)).toBe('bpm-oneke obsoleto, sustituido por operaton-oneke');
    expect(reasonText({ ...r, key: 'new-rule' }, es, has)).toBe(r.title);
  });

  it('explains the records of a reason and the approver of a draft', () => {
    expect(reasonDetail({ level: 'critical', key: 'external-no-export', title: '', detail: 'x', vars: { records: 'Repos' } }, es)).toBe('Registros: Repos');
    expect(reasonDetail({ level: 'warning', key: 'draft', title: '', detail: '' }, es)).toBe('Lo aprueba el grupo continuity-officer');
    const drafts = { level: 'warning' as const, key: 'drafts', title: '', detail: '', vars: { n: 33, services: 'a, b' }, service: '' };
    expect(reasonText(drafts, es, has)).toBe('33 perfiles sin aprobar (los aprueba continuity-officer)');
    expect(reasonDetail(drafts, es)).toBe('Servicios: a, b');
  });

  it('labels enum values, keeping unknown ones', () => {
    expect(label('lifecycle', 'external', es, has)).toBe('Externo');
    expect(label('lifecycle', 'other', es, has)).toBe('other');
    expect(label('tier', undefined, es, has)).toBe('—');
  });

  it('links the profile file, writes the export line and the expiry day', () => {
    expect(profileFileUrl({ file: 'harbor.yaml', service: 'harbor' })).toBe('https://github.com/javivillar/refresquito-services/blob/main/charts/continuity-oneke/files/profiles/harbor.yaml');
    expect(exportLine({ id: 'r', kind: 'record', export: { format: 'JSONL', schedule: 'daily' } })).toBe('JSONL · daily');
    expect(expiryDay({ live: { notAfter: '2036-11-04T08:06:22.000Z', notBefore: '', subject: '', daysLeft: 1 } })).toBe('2036-11-04');
    expect(expiryDay({})).toBe('—');
    expect([atRisk({ state: 'ok' }), atRisk({ state: 'warning' })]).toEqual([false, true]);
  });
});
