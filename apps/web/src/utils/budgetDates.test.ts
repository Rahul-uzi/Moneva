import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dayEndIso, dayStartIso, isoToDateValue, monthBounds } from './budgetDates';

/**
 * An October budget in India must cover all of October in India - the bug was
 * a budget saved as 30 Sep - 30 Oct that never saw spending on the 31st.
 */

beforeAll(() => { vi.stubEnv('TZ', 'Asia/Kolkata'); });
afterAll(() => { vi.unstubAllEnvs(); });

describe('budget dates in India', () => {
  it('runs from the 1st to the last day of the local month', () => {
    expect(monthBounds(new Date(2026, 9, 15))).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    // February, and a leap year.
    expect(monthBounds(new Date(2028, 1, 3))).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });

  it('starts at local midnight on the 1st, as the server does', () => {
    expect(dayStartIso('2026-10-01')).toBe('2026-09-30T18:30:00.000Z');
  });

  it('counts the whole of the last day', () => {
    expect(dayEndIso('2026-10-31')).toBe('2026-10-31T18:29:59.999Z');
    // A 10 pm payment on 31 October falls inside.
    const lateOnThe31st = new Date(2026, 9, 31, 22, 0).toISOString();
    expect(lateOnThe31st <= dayEndIso('2026-10-31')).toBe(true);
  });

  it('shows a stored start as the local day, not the UTC one', () => {
    expect(isoToDateValue('2026-09-30T18:30:00.000Z')).toBe('2026-10-01');
  });
});
