import { TestDatabases } from '@backstage/backend-test-utils';
import { DeploymentStore, ensureTables, lookback, monthRange, parseSweep, Seen } from './costDeployments';

jest.setTimeout(60_000);

const databases = TestDatabases.create({ ids: ['SQLITE_3'] });

const at = (iso: string) => new Date(iso);
const seen = (namespace: string, version: string, iso: string): Seen => ({ namespace, version, image: `${version}:tag`, firstSeen: at(iso) });

describe('parseSweep', () => {
  it('keeps the digest as the version, the image with its tag to show, the earliest time', () => {
    const body = {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          {
            metric: { namespace: 'shop', image: 'ghcr.io/a/web:1', image_spec: 'ghcr.io/a/web:1', image_id: 'ghcr.io/a/web@sha256:1' },
            value: [1793339212, '1793330000'],
          },
          // the same version under another label set: the earliest time wins
          { metric: { namespace: 'shop', image: 'x', image_spec: 'ghcr.io/a/web:1', image_id: 'ghcr.io/a/web@sha256:1' }, value: [1, '1793320000'] },
          // still starting, no digest yet: skipped (it is counted by its digest once it runs)
          { metric: { namespace: 'shop', image: 'ghcr.io/a/api:2', image_id: '' }, value: [1, '1793330000'] },
          { metric: { namespace: 'shop', image_spec: 'ghcr.io/a/api:2' }, value: [1, '1793330000'] },
          { metric: { image: 'no-namespace' }, value: [1, '1'] },
        ],
      },
    };
    expect(parseSweep(body)).toEqual([
      { namespace: 'shop', version: 'ghcr.io/a/web@sha256:1', image: 'ghcr.io/a/web:1', firstSeen: new Date(1793320000 * 1000) },
    ]);
    expect(parseSweep({})).toEqual([]);
  });
});

describe('lookback', () => {
  const now = at('2026-10-30T12:00:00Z');
  it('is an hour and a margin normally, the gap after a stop, 14 days at most', () => {
    expect(lookback(undefined, now)).toEqual({ seconds: 3900, step: '1m' });
    expect(lookback(at('2026-10-30T11:00:00Z'), now)).toEqual({ seconds: 3900, step: '1m' });
    expect(lookback(at('2026-10-29T12:00:00Z'), now)).toEqual({ seconds: 86700, step: '5m' });
    expect(lookback(at('2026-09-01T00:00:00Z'), now).seconds).toBe(14 * 86400);
  });
});

describe('monthRange', () => {
  it('is the month in UTC', () => {
    expect(monthRange('2026-12')).toEqual([at('2026-12-01T00:00:00Z'), at('2027-01-01T00:00:00Z')]);
    expect(monthRange('2026-13')).toBeUndefined();
    expect(monthRange('x')).toBeUndefined();
  });
});

describe('DeploymentStore', () => {
  it.each(databases.eachSupportedId())('counts each new version once, not the baseline (%p)', async id => {
    const knex = await databases.init(id);
    await ensureTables(knex);
    await ensureTables(knex); // idempotent
    const store = new DeploymentStore(knex);

    // the first sweep: what already ran is the baseline
    expect(await store.record([seen('shop', 'web@1', '2026-10-01T10:00:00Z')], at('2026-10-01T10:05:00Z'))).toBe(0);
    expect(await store.lastSweep()).toEqual(at('2026-10-01T10:05:00Z'));

    // a new version, the old one still seen, and another namespace
    expect(
      await store.record(
        [seen('shop', 'web@1', '2026-10-02T09:00:00Z'), seen('shop', 'web@2', '2026-10-02T09:30:00Z'), seen('pets', 'api@1', '2026-10-31T23:59:00Z')],
        at('2026-10-02T10:00:00Z'),
      ),
    ).toBe(2);
    // seen again later (a restart, a rollback): not counted again
    expect(await store.record([seen('shop', 'web@2', '2026-11-03T00:00:00Z')], at('2026-11-03T01:00:00Z'))).toBe(0);
    await store.record([seen('shop', 'web@3', '2026-11-03T00:30:00Z')], at('2026-11-03T02:00:00Z'));

    const oct = await store.month('2026-10');
    expect(oct?.trackedSince).toBe('2026-10-01T10:05:00.000Z');
    expect(oct?.namespaces).toEqual({
      shop: { count: 1, versions: [{ image: 'web@2:tag', firstSeen: '2026-10-02T09:30:00.000Z' }] },
      pets: { count: 1, versions: [{ image: 'api@1:tag', firstSeen: '2026-10-31T23:59:00.000Z' }] },
    });
    expect((await store.month('2026-11'))?.namespaces).toEqual({
      shop: { count: 1, versions: [{ image: 'web@3:tag', firstSeen: '2026-11-03T00:30:00.000Z' }] },
    });
    expect(await store.month('bad')).toBeUndefined();
  });
});
