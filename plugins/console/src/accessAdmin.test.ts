import { askState, MAX_REASON, validReason, candidates, peopleIn, productTitle, type GroupWithMembers } from './accessAdmin';

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

describe('requests of access', () => {
  const askable = (fields: object) => ({
    name: 'superset-users',
    admin: false,
    member: false,
    pending: false,
    ...fields,
  });

  it('tells what a group is to who looks at it', () => {
    expect(askState(askable({}))).toBe('free');
    expect(askState(askable({ pending: true }))).toBe('pending');
    // already in the group: nothing to ask, even with an old request
    expect(askState(askable({ member: true, pending: true }))).toBe('member');
  });

  it('wants a reason of at most 500 characters', () => {
    expect(validReason('  ')).toBe(false);
    expect(validReason('I build the dashboards')).toBe(true);
    expect(validReason('x'.repeat(MAX_REASON + 1))).toBe(false);
  });
});
