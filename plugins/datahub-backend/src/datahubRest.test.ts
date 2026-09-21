import { isSoftDeleted } from './datahubRest';

const s = { baseUrl: 'http://gms', token: 't' };
const answer = (status: number, body: unknown) => {
  global.fetch = jest.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
};

describe('isSoftDeleted', () => {
  it('is true when the status aspect says removed', async () => {
    answer(200, { urn: 'urn:li:dataProduct:x', status: { value: { removed: true } } });
    expect(await isSoftDeleted(s, 'dataProduct', 'urn:li:dataProduct:x')).toBe(true);
  });
  it('is false for a live asset (removed:false) and for one with no status aspect', async () => {
    answer(200, { urn: 'urn:li:dataset:x', status: { value: { removed: false } } });
    expect(await isSoftDeleted(s, 'dataset', 'urn:li:dataset:x')).toBe(false);
    answer(200, { urn: 'urn:li:dataset:x' });
    expect(await isSoftDeleted(s, 'dataset', 'urn:li:dataset:x')).toBe(false);
  });
  it('is false when DataHub has no such entity (404)', async () => {
    answer(404, {});
    expect(await isSoftDeleted(s, 'dataset', 'urn:li:dataset:x')).toBe(false);
  });
  it('surfaces other failures instead of guessing', async () => {
    answer(500, {});
    await expect(isSoftDeleted(s, 'dataset', 'urn:li:dataset:x')).rejects.toThrow(/Could not read status/);
  });
});
