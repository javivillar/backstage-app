import { changesOf, flatPrices, matches, monthlyExample, parsePrice, priceRows } from './prices';

const pricing = {
  description: 'Example', currency: 'EUR', cpuPerCoreHour: 0.0205, ramPerGiBHour: 0.0027, storagePerGiBHour: 0.0001, gpuPerHour: 0,
  spot: { cpuPerCoreHour: 0.0205, nodeLabel: '' }, network: { internetEgressPerGiB: 0.02 }, discount: { negotiated: 0 }, perDeployment: 0.5, perIncident: { P1: 50, P3: 10 },
  assistants: [{ model: 'claude-sonnet', inputPerMillion: 2.8, outputPerMillion: 14 }, { model: '*', runner: 'api', perHour: 0.4 }],
};

it('reads the prices of the configuration by path', () => {
  expect(flatPrices(pricing)).toEqual({
    cpuPerCoreHour: 0.0205, ramPerGiBHour: 0.0027, storagePerGiBHour: 0.0001, gpuPerHour: 0, 'spot.cpuPerCoreHour': 0.0205, 'spot.nodeLabel': '', 'network.internetEgressPerGiB': 0.02,
    'discount.negotiated': 0, perDeployment: 0.5, 'perIncident.P1': 50, 'perIncident.P3': 10, 'assistants.claude-sonnet.inputPerMillion': 2.8, 'assistants.claude-sonnet.outputPerMillion': 14, 'assistants.*@api.perHour': 0.4,
  });
  expect(flatPrices(undefined)).toEqual({});
});

it('lists every price with its state: charged today, set, or without a price', () => {
  const rows = priceRows(flatPrices(pricing));
  const of = (p: string) => rows.find(r => r.path === p)!;
  expect(rows.filter(r => r.group !== 'assistants')).toHaveLength(23);
  expect(of('cpuPerCoreHour')).toMatchObject({ state: 'use', by: 'opencost', opencost: 'CPU', value: 0.0205 });
  expect(of('gpuPerHour').state).toBe('off');
  expect(of('network.internetEgressPerGiB').state).toBe('set');
  expect(of('network.zoneEgressPerGiB')).toMatchObject({ state: 'off', value: undefined });
  expect(of('perIncident.P1')).toMatchObject({ state: 'use', by: 'console' });
  expect(of('perIncident.P2').state).toBe('off');
  expect(of('assistants.*@api.perHour')).toMatchObject({ group: 'assistants', state: 'use', name: '*@api · price.field.perHour' });
});

it('marks what the repository has and is not deployed, and shows the repository for a price the portal does not have yet', () => {
  const rows = priceRows(flatPrices(pricing), { cpuPerCoreHour: 0.024, ramPerGiBHour: 0.0027, 'loadBalancer.perHour': 0.01 });
  const of = (p: string) => rows.find(r => r.path === p)!;
  expect(of('cpuPerCoreHour')).toMatchObject({ value: 0.0205, pending: 0.024, base: 0.024 });
  expect(of('ramPerGiBHour').pending).toBeUndefined();
  expect(of('loadBalancer.perHour')).toMatchObject({ value: 0.01, pending: undefined, state: 'set' });
  expect(of('gpuPerHour').base).toBeUndefined();
});

it('reads what is typed, with a comma or a point', () => {
  expect(parsePrice('money', ' 0,024 ')).toBe(0.024);
  expect(parsePrice('money', '12')).toBe(12);
  expect(parsePrice('money', '-1')).toBeUndefined();
  expect(parsePrice('money', '1e3')).toBeUndefined();
  expect(parsePrice('money', '')).toBeUndefined();
  expect(parsePrice('percent', '101')).toBeUndefined();
  expect(parsePrice('percent', '15')).toBe(15);
  expect(parsePrice('label', ' tier=low ')).toBe('tier=low');
});

it('keeps only the prices that change', () => {
  const rows = priceRows({}, { cpuPerCoreHour: 0.0205, ramPerGiBHour: 0.0027, gpuPerHour: 0, 'spot.nodeLabel': '' });
  expect(changesOf(rows, { cpuPerCoreHour: '0,024', ramPerGiBHour: '0.0027', gpuPerHour: 'x', 'spot.nodeLabel': 'tier=low', perDeployment: '3' })).toEqual({
    changes: { cpuPerCoreHour: 0.024, 'spot.nodeLabel': 'tier=low' }, invalid: ['gpuPerHour'],
  });
});

it('finds a price by any of its texts', () => {
  expect(matches(['CPU', 'vCPU · hour', 'cpuPerCoreHour'], 'percore')).toBe(true);
  expect(matches(['CPU'], '  ')).toBe(true);
  expect(matches(['CPU'], 'token')).toBe(false);
});

it('works out what a month of an application costs', () => {
  const m = monthlyExample(flatPrices(pricing), 'medium');
  expect(m.model).toBe('claude-sonnet');
  expect(Object.fromEntries(m.parts.map(p => [p.id, Number(p.amount.toFixed(2))]))).toEqual({ cpu: 29.93, ram: 7.88, disk: 1.46, deployments: 1, incidents: 10, assistant: 8.4 });
  expect(m.total).toBeCloseTo(58.67, 2);
  // the discounts take off the nodes only
  expect(monthlyExample({ ...flatPrices(pricing), 'discount.negotiated': 50 }, 'medium').total).toBeCloseTo(58.67 - (29.93 + 7.884) / 2, 2);
  expect(monthlyExample({}, 'small')).toMatchObject({ total: 0, model: undefined });
});
