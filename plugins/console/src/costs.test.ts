import { parseCosts } from './costs';

it('reads the cost of each namespace, the most expensive first, without idle and unallocated', () => {
  expect(
    parseCosts({ data: [{ a: { totalCost: 1.5 }, __idle__: { totalCost: 9 }, b: { totalCost: 4 } }, { a: { totalCost: 1 }, c: { totalCost: 'x' } }] }),
  ).toEqual([
    { namespace: 'b', total: 4 },
    { namespace: 'a', total: 2.5 },
  ]);
  expect(parseCosts(null)).toEqual([]);
});
