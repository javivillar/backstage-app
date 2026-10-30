import { addCounts, deploymentsCost, describeCounts, efficiency, IDLE, incidentCount, incidentsCost, money, parseAllocations, parseDeployments, parseIncidentCounts, perMonth } from './openCost';

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

describe('deployments', () => {
  it('parses the month and prices it', () => {
    const d = parseDeployments({
      month: '2026-10',
      trackedSince: '2026-10-30T07:00:00.000Z',
      namespaces: { shop: { count: 2, versions: [{ image: 'web:1', firstSeen: 'x' }, { image: 'web:2', firstSeen: 'y' }, { bad: 1 }] } },
    });
    expect(d.month).toBe('2026-10');
    expect(d.byNamespace.get('shop')).toEqual({ count: 2, versions: [{ image: 'web:1', firstSeen: 'x' }, { image: 'web:2', firstSeen: 'y' }] });
    expect(parseDeployments(null).byNamespace.size).toBe(0);
    expect(deploymentsCost(3, { currency: 'EUR', perDeployment: 0.5 })).toBe(1.5);
    expect(deploymentsCost(undefined, { currency: 'EUR', perDeployment: 0.5 })).toBe(0);
    expect(deploymentsCost(3, { currency: 'EUR' })).toBeUndefined();
  });
});

describe('incidents', () => {
  it('parses the counts by element, adds them and prices them by priority', () => {
    const m = parseIncidentCounts({
      month: '2026-10',
      elements: [
        { ref: 'component:default/Petstore-oneke', priority: 'P1', count: 2 },
        { ref: 'component:default/petstore-oneke', priority: 'P3', count: 1 },
        { ref: 'system:default/refresquito', priority: 'P2', count: 1 },
        { ref: 'x', priority: 'P9', count: 5 },
      ],
    });
    expect(m.get('component:default/petstore-oneke')).toEqual({ P1: 2, P3: 1 });
    expect(m.size).toBe(2);
    const all = addCounts(m.get('component:default/petstore-oneke')!, m.get('system:default/refresquito')!);
    expect(all).toEqual({ P1: 2, P2: 1, P3: 1 });
    expect(incidentCount(all)).toBe(4);
    expect(describeCounts(all)).toBe('P1 2 · P2 1 · P3 1');
    const pricing = { currency: 'EUR', perIncident: { P1: 50, P2: 20, P3: 5 } };
    expect(incidentsCost(all, pricing)).toBe(125);
    expect(incidentsCost({ P4: 3 }, pricing)).toBe(0); // no price for P4
    expect(incidentsCost(all, { currency: 'EUR' })).toBeUndefined();
    expect(parseIncidentCounts(undefined).size).toBe(0);
  });
});
