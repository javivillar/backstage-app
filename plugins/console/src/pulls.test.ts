import { type ChangePull, freshPath, isPending, orderPulls } from './pulls';

const pull = (number: number, state: ChangePull['state'], created: string, extra: Partial<ChangePull> = {}): ChangePull => ({
  number, title: `change ${number}`, url: `https://github.com/o/r/pull/${number}`, branch: `console/prices-${number}`, created, state, ...extra,
});

describe('pending changes', () => {
  it('puts what still waits first, each group newest first', () => {
    const pulls = [
      pull(1, 'merged', '2026-11-01T10:00:00Z', { closed: '2026-11-14T10:00:00Z' }),
      pull(2, 'checking', '2026-11-10T10:00:00Z'),
      pull(3, 'closed', '2026-11-12T10:00:00Z', { closed: '2026-11-12T11:00:00Z' }),
      pull(4, 'ready', '2026-11-13T10:00:00Z'),
    ];
    expect(orderPulls(pulls).map(p => p.number)).toEqual([4, 2, 1, 3]);
    expect(pulls.filter(isPending).map(p => p.number)).toEqual([2, 4]);
  });

  it('keeps only the branches of what the page shows', () => {
    const pulls = [pull(1, 'open', '2026-11-01T10:00:00Z', { branch: 'console/bpmn-acme-fix-defects-x1' }), pull(2, 'open', '2026-11-02T10:00:00Z', { branch: 'console/bpmn-acme-ship-parts-x2' })];
    expect(orderPulls(pulls, 'console/bpmn-acme-fix-defects-').map(p => p.number)).toEqual([1]);
    expect(orderPulls(pulls, 'console/bpmn-other-')).toEqual([]);
  });

  it('asks for a fresh read only when refreshed by hand', () => {
    expect(freshPath('/prices/pulls', false)).toBe('/prices/pulls');
    expect(freshPath('/prices/pulls', true)).toBe('/prices/pulls?fresh=1');
    expect(freshPath('/pulls?kind=organisation', true)).toBe('/pulls?kind=organisation&fresh=1');
  });
});
