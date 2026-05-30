import { describe, expect, it } from 'vitest';
import { nextFireTime, validateCronExpression } from './schedule.js';

describe('cron schedule helpers', () => {
  it('validates 5-field cron expressions', () => {
    expect(validateCronExpression('*/5 * * * *')).toEqual({ ok: true, error: null });
    expect(validateCronExpression('* * *')).toMatchObject({ ok: false });
    expect(validateCronExpression('61 * * * *')).toMatchObject({ ok: false });
  });

  it('computes the next fire time in UTC', () => {
    expect(nextFireTime('0 3 * * *', new Date('2026-05-30T02:59:00.000Z')).toISOString()).toBe(
      '2026-05-30T03:00:00.000Z',
    );
    expect(nextFireTime('*/15 * * * *', new Date('2026-05-30T03:01:00.000Z')).toISOString()).toBe(
      '2026-05-30T03:15:00.000Z',
    );
  });

  it('supports weekday and range fields', () => {
    expect(nextFireTime('0 9 * * 1-5', new Date('2026-05-29T09:01:00.000Z')).toISOString()).toBe(
      '2026-06-01T09:00:00.000Z',
    );
  });
});
