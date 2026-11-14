import { matches, programmeOf, programmeRows, programmesOf, rowTexts } from './programmes';
import type { InfraView, Programme } from './zone';

const prog = (zone: string, name: string, over: Partial<Programme> = {}): Programme => ({ zone, name, title: name.toUpperCase(), description: `About ${name}.`, industry: 'Air', customer: 'Air Force', nations: ['DE', 'ES'], spain: true, confidence: 'high', ...over });
const view = {
  warnings: [], drift: [], zones: [],
  catalog: [
    { name: 'occar', label: 'OCCAR', status: 'complete', enabled: true, programs: [{ name: 'a400m', n: 1, declared: true, ok: true }] },
    { name: 'nato', label: 'NATO', status: 'complete', enabled: true, programs: [
      { name: 'sirtap', n: 1, declared: true, ok: true, cluster: 'oneke-nato-sirtap' },
      { name: 'cistest', n: 2, declared: true, ok: true, cluster: 'oneke-nato-cistest', test: true },
      { name: 'integration', n: 3, kind: 'integration', declared: true, ok: true },
    ] },
    { name: 'diflim', label: 'Limited distribution', status: 'reserved', enabled: false, programs: [] },
  ],
  programmeCatalogue: { industries: ['Air', 'Land'], programmes: [prog('occar', 'a400m'), prog('occar', 'boxer', { industry: 'Land', customer: 'Army', nations: ['DE', 'NL'], spain: false }), prog('nato', 'efa', { managingBody: 'NETMA' }), prog('diflim', 'sirtap', { customerDetail: 'Ejército de Tierra (ES)' })] },
} as InfraView;

describe('the programme catalogue next to the platform', () => {
  it('lists the programmes of a zone', () => {
    expect(programmesOf(view, 'occar').map(p => p.name)).toEqual(['a400m', 'boxer']);
    expect(programmeOf(view, 'nato', 'efa')?.managingBody).toBe('NETMA');
    expect(programmeOf(view, 'nato', 'a400m')).toBeUndefined();
  });

  it('says where each programme is: its zone, another zone, or nowhere; and adds the test programmes', () => {
    const rows = programmeRows(view);
    const by = (id: string) => rows.find(r => `${r.zone}/${r.name}` === id)!;
    expect(by('occar/a400m').placed).toEqual({ zone: 'occar', name: 'a400m', cluster: undefined });
    expect(by('occar/boxer').placed).toBeUndefined();
    expect(by('occar/boxer').elsewhere).toBeUndefined();
    expect(by('diflim/sirtap').placed).toBeUndefined();
    expect(by('diflim/sirtap').elsewhere).toEqual({ zone: 'nato', name: 'sirtap', cluster: 'oneke-nato-sirtap' });
    expect(by('nato/cistest')).toMatchObject({ test: true, placed: { cluster: 'oneke-nato-cistest' } });
    expect(rows.map(r => r.name)).not.toContain('integration');
    expect(rows).toHaveLength(5);
  });

  it('an older host has no catalogue: only the test programmes', () => {
    expect(programmeRows({ ...view, programmeCatalogue: undefined }).map(r => r.name)).toEqual(['cistest']);
  });
});

describe('search', () => {
  const texts = rowTexts({ ...prog('nato', 'efa', { title: 'Eurofighter Typhoon (EFA)', managingBody: 'DGAM / NETMA', customerDetail: 'Luftwaffe (DE), Land Forces' }), test: false }, 'NATO');
  it('typed text matches anywhere, in any value', () => {
    expect(matches(texts, 'euro')).toBe(true);
    expect(matches(texts, 'netma')).toBe(true);
    expect(matches(texts, 'nato')).toBe(true);
    expect(matches(texts, 'navy')).toBe(false);
    expect(matches(texts, '  ')).toBe(true);
  });
  it('a clicked value matches as a whole word', () => {
    expect(matches(texts, 'ES', true)).toBe(true);
    expect(matches(texts, 'NETMA', true)).toBe(true);
    expect(matches(texts, 'DE', true)).toBe(true);
    expect(matches(texts, 'Forc', true)).toBe(false);
    expect(matches(texts, 'Air Force', true)).toBe(true);
    expect(matches(texts, 'Typhoon (EFA)', true)).toBe(true);
  });
});
