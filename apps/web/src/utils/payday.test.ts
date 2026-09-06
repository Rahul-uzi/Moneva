import { describe, it, expect } from 'vitest';
import { cycleLengthDays, daysBetween, describePayday, nextPayday } from './payday';
import type { RecurringIncome } from '../types/api';

const stream = (over: Partial<RecurringIncome>): RecurringIncome => ({
  id: 'r1',
  user_id: 'u1',
  source: 'Salary',
  amount_minor: 7500000,
  frequency: 'monthly',
  next_occurrence: '2026-09-30',
  active: true,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  ...over,
});

const on = (iso: string) => new Date(`${iso}T10:30:00`);

describe('cycleLengthDays', () => {
  it('knows the frequencies the app actually offers', () => {
    expect(cycleLengthDays('weekly')).toBe(7);
    expect(cycleLengthDays('fortnightly')).toBe(14);
    expect(cycleLengthDays('monthly')).toBe(30);
    expect(cycleLengthDays('yearly')).toBe(365);
  });

  it('is not fooled by casing or stray spacing from the API', () => {
    expect(cycleLengthDays(' Monthly ')).toBe(30);
    expect(cycleLengthDays('WEEKLY')).toBe(7);
  });

  it('falls back to monthly rather than dividing by nothing', () => {
    expect(cycleLengthDays('lunar')).toBe(30);
    expect(cycleLengthDays('')).toBe(30);
  });
});

describe('daysBetween', () => {
  it('counts calendar days, not elapsed hours', () => {
    // 23:00 tonight to 01:00 tomorrow is two hours, and one day.
    const late = new Date('2026-09-05T23:00:00');
    const early = new Date('2026-09-06T01:00:00');
    expect(daysBetween(late, early)).toBe(1);
  });

  it('crosses months and years', () => {
    expect(daysBetween(on('2026-09-28'), on('2026-10-02'))).toBe(4);
    expect(daysBetween(on('2026-12-30'), on('2027-01-02'))).toBe(3);
  });

  it('is zero for the same day whatever the times', () => {
    expect(daysBetween(new Date('2026-09-05T00:01:00'), new Date('2026-09-05T23:59:00'))).toBe(0);
  });
});

describe('nextPayday', () => {
  it('counts down to the soonest stream, not the first in the list', () => {
    const found = nextPayday(
      [
        stream({ id: 'far', next_occurrence: '2026-09-30' }),
        stream({ id: 'near', source: 'Retainer', next_occurrence: '2026-09-11' }),
      ],
      on('2026-09-05'),
    );
    expect(found?.id).toBe('near');
    expect(found?.daysAway).toBe(6);
  });

  it('reports today as zero days, so the card can say "Today"', () => {
    const found = nextPayday([stream({ next_occurrence: '2026-09-05' })], on('2026-09-05'));
    expect(found?.daysAway).toBe(0);
    expect(describePayday(0)).toBe('Today');
  });

  /* Money that was due and never recorded belongs to the due-salary card. A
     countdown answering the same question with a negative number would be a
     second, contradictory answer. */
  it('ignores anything already past', () => {
    expect(nextPayday([stream({ next_occurrence: '2026-09-01' })], on('2026-09-05'))).toBeNull();
  });

  it('ignores streams that were switched off', () => {
    expect(nextPayday([stream({ active: false })], on('2026-09-05'))).toBeNull();
  });

  it('ignores a stream with no date, and one whose date is nonsense', () => {
    expect(nextPayday([stream({ next_occurrence: '' })], on('2026-09-05'))).toBeNull();
    expect(nextPayday([stream({ next_occurrence: 'not-a-date' })], on('2026-09-05'))).toBeNull();
  });

  it('returns null for an empty list rather than throwing', () => {
    expect(nextPayday([], on('2026-09-05'))).toBeNull();
  });

  it('fills the arc as the cycle runs down', () => {
    const justPaid = nextPayday([stream({ next_occurrence: '2026-10-05' })], on('2026-09-05'));
    const almostThere = nextPayday([stream({ next_occurrence: '2026-09-08' })], on('2026-09-05'));
    expect(justPaid!.progress).toBeLessThan(0.1);
    expect(almostThere!.progress).toBeGreaterThan(0.85);
    expect(almostThere!.progress).toBeLessThanOrEqual(1);
  });

  /* A stream anchored oddly can sit further out than its own cycle. The arc
     must not be handed a negative share to draw. */
  it('clamps a payday further away than one whole cycle', () => {
    const found = nextPayday(
      [stream({ frequency: 'weekly', next_occurrence: '2026-10-05' })],
      on('2026-09-05'),
    );
    expect(found?.progress).toBe(0);
  });

  it('lands exactly on a full arc the day it arrives', () => {
    expect(nextPayday([stream({ next_occurrence: '2026-09-05' })], on('2026-09-05'))?.progress).toBe(1);
  });
});

describe('describePayday', () => {
  it('reads the way people say it', () => {
    expect(describePayday(0)).toBe('Today');
    expect(describePayday(1)).toBe('Tomorrow');
    expect(describePayday(12)).toBe('12 days');
  });
});
