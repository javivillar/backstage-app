import { chargeByAssistant, chargeBySystem, parseUsage, PLATFORM, priceOf, systemsOf, tokens, usageCost, type UsageGroup } from './assistantUsage';

const g = (o: Partial<UsageGroup>): UsageGroup => ({
  assistant: 'functional',
  user: 'user:default/ana',
  runner: 'api',
  model: 'claude-opus-5-5',
  systems: [],
  namespaces: [],
  components: [],
  questions: 1,
  unreported: 0,
  input: 1_000_000,
  output: 100_000,
  cacheRead: 2_000_000,
  cacheWrite: 0,
  ms: 60_000,
  ...o,
});

const index = {
  ofNamespace: new Map([['nato-sirtap-petstore-oneke', 'petstore']]),
  ofComponent: new Map([['animalshelter-backend', 'animalshelter']]),
};

const prices = [
  { model: 'claude-opus', inputPerMillion: 5, outputPerMillion: 25, cacheReadPerMillion: 0.5 },
  // a local model: the server, 0.40 an hour of answering
  { model: 'gpt-oss', perHour: 0.4 },
];

describe('the cost of the assistants', () => {
  it('prices by tokens, or by hours of a local model, and leaves unpriced what matches no price', () => {
    expect(usageCost(g({}), prices)).toBeCloseTo(5 + 2.5 + 1);
    expect(usageCost(g({ model: 'gpt-oss-20b', input: 0, output: 0, cacheRead: 0, ms: 2 * 3600_000 }), prices)).toBeCloseTo(0.8);
    expect(usageCost(g({ model: 'qwen3' }), prices)).toBeUndefined();
    expect(priceOf({ model: 'claude-opus-5-5', runner: 'claude-code' }, [{ runner: 'claude-code', perHour: 0 }, ...prices])?.perHour).toBe(0);
  });

  it('charges the chosen system, else what the tools looked at, else the platform', () => {
    expect(systemsOf(g({ system: 'petstore', systems: ['animalshelter'] }), index)).toEqual(['petstore']);
    expect(systemsOf(g({ namespaces: ['nato-sirtap-petstore-oneke'], components: ['animalshelter-backend'] }), index)).toEqual(['animalshelter', 'petstore']);
    expect(systemsOf(g({ namespaces: ['kube-system'] }), index)).toEqual([PLATFORM]);
  });

  it('splits a question about two systems in equal parts', () => {
    const usage = parseUsage({
      month: '2026-10',
      all: true,
      groups: [g({ systems: ['petstore', 'animalshelter'] }), g({ system: 'petstore', user: undefined }), g({ model: 'gpt-oss-20b', ms: 3600_000 })],
    });
    const { bySystem, total } = chargeBySystem(usage, index, prices);
    expect(bySystem.get('petstore')!.cost).toBeCloseTo(8.5 / 2 + 8.5);
    expect(bySystem.get('animalshelter')!.questions).toBeCloseTo(0.5);
    expect(bySystem.get(PLATFORM)!.cost).toBeCloseTo(0.4);
    expect(total.cost).toBeCloseTo(8.5 * 2 + 0.4);
    expect(total.questions).toBe(3);
    const rows = chargeByAssistant(usage, prices);
    expect(rows.map(r => r.user)).toEqual(['user:default/ana', undefined]);
    expect(rows[0].models).toEqual(new Set(['claude-opus-5-5', 'gpt-oss-20b']));
  });

  it('reads the answer of the backend tolerantly', () => {
    expect(parseUsage({ groups: [{ assistant: 'ops', input: 'x', systems: 'no' }, { nope: 1 }] }).groups).toEqual([
      expect.objectContaining({ assistant: 'ops', input: 0, systems: [], user: undefined }),
    ]);
    expect(tokens(1_234_567)).toBe('1.2 M');
    expect(tokens(35_400)).toBe('35 k');
  });
});
