import { isAllowed } from './access';

describe('isAllowed', () => {
  it('lets every signed-in user in when no group is configured', () => {
    expect(isAllowed([], ['user:default/ana'])).toBe(true);
  });
  it('needs one of the configured groups', () => {
    expect(isAllowed(['console-beta'], ['user:default/ana', 'group:default/console-beta'])).toBe(true);
    expect(isAllowed(['console-beta'], ['user:default/ana', 'group:default/backstage-admin'])).toBe(false);
  });
  it('ignores case', () => {
    expect(isAllowed(['Console-Beta'], ['group:default/console-beta'])).toBe(true);
  });
});
