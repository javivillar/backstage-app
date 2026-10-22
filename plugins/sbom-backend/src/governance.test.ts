import { governanceFacts, readResult } from './governance';

describe('data governance facts', () => {
  const now = new Date('2026-10-22T12:00:00Z');

  it('reads the result of the daily check on the data product', () => {
    const answer = { data: { dataProduct: { properties: { customProperties: [
      { key: 'application', value: 'petstore' },
      { key: 'refresquito.governance', value: JSON.stringify({ checkedAt: '2026-10-22T05:41:00+00:00', assets: 12, unclassified: 0,
        aboveCeiling: 0, belowUpstream: 1, exceptionExpired: 0, exceptionExpiring: 1, exceptionsInForce: 2, contractChecks: 7,
        contractsFailing: 2, ok: false }) },
    ] } } } };
    expect(governanceFacts(readResult(answer), now)).toEqual({
      governanceChecked: true, governanceCheckedAt: '2026-10-22T05:41:00+00:00', dataAssets: 12, unclassifiedAssets: 0,
      aboveCeilingAssets: 0, belowUpstreamAssets: 1, expiredExceptions: 0, expiringExceptions: 1, exceptionsInForce: 2,
      contractChecks: 7, contractsFailing: 2,
    });
  });

  it('says not reported when there is no check, and stale after 48 hours', () => {
    expect(readResult({ data: { dataProduct: null } })).toBeUndefined();
    expect(readResult({ data: { dataProduct: { properties: { customProperties: [{ key: 'refresquito.governance', value: '{' }] } } } })).toBeUndefined();
    const none = governanceFacts(undefined, now);
    expect(none.governanceChecked).toBe(false);
    expect(none.unclassifiedAssets).toBe(-1);
    expect(governanceFacts({ checkedAt: '2026-10-19T00:00:00Z' }, now).governanceChecked).toBe(false);
  });
});
