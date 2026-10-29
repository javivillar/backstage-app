import { efficiency, IDLE, money, parseAllocations, perMonth } from './openCost';

// the shape of GET /allocation/compute?aggregate=namespace&accumulate=true of OpenCost 1.121
const body = {
  code: 200,
  data: [
    {
      'nato-sirtap-petstore-oneke': {
        name: 'nato-sirtap-petstore-oneke',
        properties: { namespace: 'nato-sirtap-petstore-oneke', cluster: 'oneke' },
        minutes: 10080,
        cpuCoreRequestAverage: 0.5,
        cpuCoreUsageAverage: 0.1,
        cpuCost: 1.2,
        ramByteRequestAverage: 1073741824,
        ramByteUsageAverage: 536870912,
        ramCost: 0.8,
        pvCost: 0.05,
        networkCost: 0,
        totalCost: 2.05,
      },
      [IDLE]: { name: IDLE, totalCost: 10, cpuCost: 6, ramCost: 4 },
    },
  ],
};

describe('parseAllocations', () => {
  it('reads the cost, the reservations and the use of each namespace', () => {
    const m = parseAllocations(body);
    const pet = m.get('nato-sirtap-petstore-oneke')!;
    expect(pet).toMatchObject({ total: 2.05, cpu: 1.2, ram: 0.8, disk: 0.05, cpuRequested: 0.5, cpuUsed: 0.1, minutes: 10080 });
    expect(m.get(IDLE)?.total).toBe(10);
  });

  it('adds up the sets of an answer that is not accumulated', () => {
    const m = parseAllocations({ data: [{ ns: { totalCost: 1, cpuCost: 1 } }, { ns: { totalCost: 2, cpuCost: 2 } }] });
    expect(m.get('ns')).toMatchObject({ total: 3, cpu: 3 });
  });

  it('is empty for an answer without data, and ignores what is not a number', () => {
    expect(parseAllocations({}).size).toBe(0);
    expect(parseAllocations({ data: [{ ns: { totalCost: 'x' } }] }).get('ns')?.total).toBe(0);
  });
});

describe('figures', () => {
  it('efficiency is used over reserved, and unknown without a reservation', () => {
    expect(efficiency(0.1, 0.5)).toBeCloseTo(20);
    expect(efficiency(0.1, 0)).toBeUndefined();
  });

  it('a month at the pace of the last day', () => {
    expect(perMonth({ total: 1 } as any)).toBeCloseTo(30.4);
    expect(perMonth(undefined)).toBeUndefined();
  });

  it('money in the currency, with cents below 10', () => {
    expect(money(2.05, 'EUR')).toMatch(/2,05/);
    expect(money(1234, 'EUR')).toMatch(/1\.?234/);
    expect(money(undefined, 'EUR')).toBe('—');
  });
});
