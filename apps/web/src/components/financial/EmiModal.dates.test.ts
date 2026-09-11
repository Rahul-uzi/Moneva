import { describe, it, expect } from 'vitest';
import { asDateInput, fromDateInput } from './EmiModal';
import { emiProgress } from '../../utils/cardCycle';

/**
 * The start date has to survive the trip out and back.
 *
 * It is the one field on an instalment plan that must be right - every figure
 * on the card screen is counted forward from it - and it crosses two
 * conversions on the way: a date input holds yyyy-mm-dd, the API holds an
 * instant. Sent as midnight UTC and read back through toISOString, a plan
 * started on the 1st came back as the last day of the previous month for any
 * reader west of Greenwich, and walked a day earlier on every edit.
 *
 * These run on whatever timezone the machine is set to, which is the point.
 */
describe('the start date a user picked', () => {
  const DAYS = ['2026-03-10', '2026-01-01', '2026-12-31', '2026-02-28', '2024-02-29'];

  it('comes back as the day that was chosen', () => {
    for (const day of DAYS) {
      const stored = fromDateInput(day);
      expect(stored).not.toBeNull();
      expect(asDateInput(stored as string)).toBe(day);
    }
  });

  it('does not drift when a plan is edited over and over', () => {
    // Each edit reads the stored instant into the input and writes it back.
    // A conversion that loses half a day walks the date backwards one save at
    // a time, which is invisible until the schedule is a month out.
    let stored = fromDateInput('2026-01-01') as string;
    for (let edit = 0; edit < 12; edit += 1) {
      stored = fromDateInput(asDateInput(stored)) as string;
    }
    expect(asDateInput(stored)).toBe('2026-01-01');
  });

  it('is the same day the instalment schedule counts from', () => {
    // The two halves have to agree: whatever day the form shows is the day
    // emiProgress treats as the start, or the count of instalments paid is
    // off by one for part of every month.
    const stored = fromDateInput('2026-03-01') as string;
    const plan = { name: 'Fridge', monthlyMinor: 100, months: 6, startedAt: stored };

    // The day before the first instalment: none taken.
    expect(emiProgress(plan, new Date(2026, 1, 28, 12).getTime()).paidCount).toBe(0);
    // The day itself: one.
    expect(emiProgress(plan, new Date(2026, 2, 1, 0, 5).getTime()).paidCount).toBe(1);
    expect(emiProgress(plan, new Date(2026, 2, 1, 23, 55).getTime()).paidCount).toBe(1);
  });

  it('refuses a date that is not one', () => {
    expect(fromDateInput('')).toBeNull();
    expect(fromDateInput('not-a-date')).toBeNull();
    expect(asDateInput('not-a-date')).toBe('');
  });
});
