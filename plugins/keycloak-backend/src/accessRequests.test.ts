import { MAX_REASON, reasonOf } from './accessRequests';

describe('requests of access', () => {
  it('wants a reason, trimmed and not too long', () => {
    expect(reasonOf('  I maintain the dashboards of SIRTAP ')).toBe('I maintain the dashboards of SIRTAP');
    expect(reasonOf('   ')).toBeUndefined();
    expect(reasonOf(undefined)).toBeUndefined();
    expect(reasonOf(42)).toBeUndefined();
    expect(reasonOf('x'.repeat(MAX_REASON))).toHaveLength(MAX_REASON);
    expect(reasonOf('x'.repeat(MAX_REASON + 1))).toBeUndefined();
  });
});
