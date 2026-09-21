import { impactHeadline, summarizeImpact } from './impact';

const e = (urn: string, type: string, degree: number, over: Record<string, unknown> = {}) => ({
  degree,
  entity: { urn, type, ...(type === 'DATASET' ? { name: urn.split(':').pop() } : {}), ...over },
});
const owner = (u: string) => ({ ownership: { owners: [{ owner: { urn: u } }] } });
const crit = { tags: { tags: [{ tag: { urn: 'urn:li:tag:dq-critical' } }] } };

describe('summarizeImpact', () => {
  const raw = {
    total: 4,
    searchResults: [
      e('urn:li:dataset:b', 'DATASET', 2, owner('urn:li:corpGroup:finance')),
      e('urn:li:chart:c', 'CHART', 3, { properties: { name: 'Revenue chart' }, ...owner('urn:li:corpuser:ana@x.com'), ...crit }),
      e('urn:li:dataset:a', 'DATASET', 1, { ...owner('urn:li:corpGroup:finance'), ...crit }),
      e('urn:li:dashboard:d', 'DASHBOARD', 3),
    ],
  };
  const i = summarizeImpact('urn:li:dataset:root', raw);

  it('counts by type, critical assets and direct consumers', () => {
    expect(i.total).toBe(4);
    expect(i.byType).toEqual({ dataset: 2, chart: 1, dashboard: 1 });
    expect(i.critical).toBe(2);
    expect(i.directConsumers).toBe(1);
    expect(i.maxDegree).toBe(3);
  });

  it('lists the distinct owners to notify, sorted', () => {
    expect(i.owners).toEqual(['urn:li:corpGroup:finance', 'urn:li:corpuser:ana@x.com']);
  });

  it('orders closest first, critical ahead at equal distance, and uses the chart name', () => {
    expect(i.items.map(x => x.degree)).toEqual([1, 2, 3, 3]);
    expect(i.items[2].critical).toBe(true); // the critical chart before the plain dashboard at degree 3
    expect(i.items.find(x => x.type === 'chart')!.name).toBe('Revenue chart');
  });

  it('flags a truncated page (total larger than what was fetched) and honours the item limit', () => {
    const t = summarizeImpact('urn:li:dataset:root', { ...raw, total: 120 }, 2);
    expect(t.truncated).toBe(true);
    expect(t.fetched).toBe(4);
    expect(t.items).toHaveLength(2);
  });

  it('says so plainly when nothing depends on the asset', () => {
    const none = summarizeImpact('urn:li:dataset:root', { total: 0, searchResults: [] });
    expect(impactHeadline(none)).toMatch(/No downstream assets/);
    expect(impactHeadline(i)).toBe('4 downstream assets affected (2 dataset, 1 chart, 1 dashboard, 2 marked dq-critical); 2 owners to notify.');
  });
});
