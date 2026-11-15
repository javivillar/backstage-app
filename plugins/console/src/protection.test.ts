import { keptDays, monthlyCost, planTone, schedule, size, when } from './protection';

const t = (k: string, v?: Record<string, string | number>) => `${k}${v ? `:${Object.values(v).join(',')}` : ''}`;

describe('data continuity helpers', () => {
  it('writes sizes', () => {
    expect(size(0, 'en')).toBe('—');
    expect(size(1.6 * 2 ** 30, 'en')).toBe('1.6 GiB');
    expect(size(310 * 2 ** 20, 'en')).toBe('310 MiB');
  });
  it('says when in words', () => {
    const now = new Date(2026, 10, 15, 12, 0);
    expect(when(undefined, t, 'en', now)).toBe('—');
    expect(when(new Date(2026, 10, 15, 2, 4).toISOString(), t, 'en-GB', now)).toBe('dp.when.today:02:04');
    expect(when(new Date(2026, 10, 14, 23, 0).toISOString(), t, 'en-GB', now)).toBe('dp.when.yesterday:23:00');
    expect(when(new Date(2026, 10, 12, 2, 0).toISOString(), t, 'en-GB', now)).toBe('dp.when.days:3');
  });
  it('reads the schedules of the chart and leaves any other cron as it is', () => {
    expect(schedule(undefined, t)).toBe('dp.cron.none');
    expect(schedule('0 */6 * * *', t)).toBe('dp.cron.hours:6');
    expect(schedule('30 2 * * *', t)).toBe('dp.cron.daily:02:30 UTC');
    expect(schedule('0 4 * * 0', t)).toBe('dp.cron.weekly:04:00 UTC,dp.day.0');
    expect(schedule('0 4 1 * *', t)).toBe('0 4 1 * *');
    expect(keptDays('336h')).toBe(14);
    expect(keptDays(undefined)).toBeUndefined();
  });
  it('charges snapshots and backups per GiB and month', () => {
    const app = { snapshotBytes: 2 * 2 ** 30, backupBytes: 10 * 2 ** 30 };
    expect(monthlyCost(app, { currency: 'EUR' })).toBeUndefined();
    expect(monthlyCost(app, { snapshot: 0.05, backup: 0.02, currency: 'EUR' })).toEqual({ snapshots: 0.1, backups: 0.2, total: expect.closeTo(0.3) });
    expect(planTone('none')).toBe('warn');
    expect(planTone('critical')).toBe('info');
  });
});
