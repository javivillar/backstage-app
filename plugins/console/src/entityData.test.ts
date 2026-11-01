import { parseChanges, parseWeek, totals } from './entityData';

describe('entity data', () => {
  it('reads the week of a namespace by parts and by day', () => {
    const acc = { data: [{ shop: { totalCost: 3.84, cpuCost: 1.21, ramCost: 1.62, pvCost: 0.14 }, other: { totalCost: 9 } }] };
    const daily = { data: [{ shop: { totalCost: 0.5 } }, { other: { totalCost: 1 } }, { shop: { totalCost: 0.7 } }] };
    expect(parseWeek(acc, daily, 'shop')).toEqual({ total: 3.84, cpu: 1.21, ram: 1.62, disk: 0.14, days: [0.5, 0, 0.7] });
    expect(parseWeek(acc, daily, 'none')).toBeUndefined();
  });

  it('lists the images deployed in two months, newest first, once each', () => {
    const now = { namespaces: { shop: { versions: [{ image: 'api:2', firstSeen: '2026-11-01T08:00:00Z' }] } } };
    const prev = { namespaces: { shop: { versions: [{ image: 'api:1', firstSeen: '2026-10-20T08:00:00Z' }, { image: 'api:2', firstSeen: '2026-11-01T08:00:00Z' }] } } };
    expect(parseChanges([now, prev], 'shop')).toEqual([
      { image: 'api:2', at: '2026-11-01T08:00:00Z' },
      { image: 'api:1', at: '2026-10-20T08:00:00Z' },
    ]);
  });

  it('adds up the findings of several images', () => {
    expect(totals([{ image: 'a', counts: { CRITICAL: 1, HIGH: 2 }, kev: 1 }, { image: 'b', counts: { HIGH: 1, LOW: 4 }, kev: 0 }])).toEqual({ critical: 1, high: 3, medium: 0, low: 4, kev: 1 });
  });
});
