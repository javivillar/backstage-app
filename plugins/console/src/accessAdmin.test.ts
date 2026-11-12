import { candidates, peopleIn, productTitle, type GroupWithMembers } from './accessAdmin';

const group = (name: string, members: string[]): GroupWithMembers => ({
  name,
  stages: [],
  admin: false,
  portalOnly: false,
  canChange: true,
  members: members.map(username => ({ username, name: '' })),
});

describe('access administration client', () => {
  it('names a product without the suffix of its chart', () => {
    expect(productTitle('superset-oneke')).toBe('superset');
    expect(productTitle('animalshelter')).toBe('animalshelter');
  });

  it('counts each person once', () => {
    expect(peopleIn([group('a', ['ana', 'luis']), group('b', ['ana'])])).toBe(2);
    expect(peopleIn([])).toBe(0);
  });

  it('offers only the people not yet in the group', () => {
    const found = [{ username: 'ana', name: 'Ana' }, { username: 'luis', name: 'Luis' }];
    expect(candidates(found, [{ username: 'ana', name: 'Ana' }])).toEqual([{ username: 'luis', name: 'Luis' }]);
  });
});
