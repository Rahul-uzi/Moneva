import { describe, expect, it } from 'vitest';
import { matchSalaryStream, nextOccurrenceAfter, type IncomeLike } from './salaryMatch';
import type { RecurringIncome } from '../types/api';

const stream = (over: Partial<RecurringIncome> = {}): RecurringIncome => ({
  id: 's1',
  user_id: 'u1',
  source: 'Monthly Salary',
  amount_minor: 2500000,
  frequency: 'monthly',
  next_occurrence: '2026-10-10T00:00:00Z',
  anchor_day: 10,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
});

const income = (over: Partial<IncomeLike> = {}): IncomeLike => ({
  amountPaise: 2500000,
  at: new Date('2026-10-08T09:00:00Z'),
  text: 'Salary',
  ...over,
});

describe('matchSalaryStream', () => {
  it('matches a salary paid two days early', () => {
    const match = matchSalaryStream(income(), [stream()]);
    expect(match?.stream.id).toBe('s1');
    expect(match?.amountChanged).toBe(false);
  });

  it('still matches when the figure changed, and says so', () => {
    const match = matchSalaryStream(income({ amountPaise: 2800000 }), [stream()]);
    expect(match?.stream.id).toBe('s1');
    expect(match?.amountChanged).toBe(true);
  });

  it('matches on the company name alone', () => {
    const match = matchSalaryStream(
      income({ text: 'Credited by Infosys Ltd' }),
      [stream({ source: 'Infosys' })],
    );
    expect(match?.stream.id).toBe('s1');
  });

  it('matches on the Salary category when the text says nothing', () => {
    const match = matchSalaryStream(
      income({ text: 'HDFC credit', categoryName: 'Salary' }),
      [stream()],
    );
    expect(match?.stream.id).toBe('s1');
  });

  // The whole point of the window: money landing nowhere near payday is
  // ordinary income, however it is labelled.
  it('ignores income three weeks before payday', () => {
    expect(matchSalaryStream(income({ at: new Date('2026-09-19T09:00:00Z') }), [stream()])).toBeNull();
  });

  it('ignores income a month after payday', () => {
    expect(matchSalaryStream(income({ at: new Date('2026-11-11T09:00:00Z') }), [stream()])).toBeNull();
  });

  it('ignores income that names nothing', () => {
    expect(matchSalaryStream(income({ text: 'Sold my old phone' }), [stream()])).toBeNull();
  });

  it('will not match a three-letter source inside an unrelated word', () => {
    expect(
      matchSalaryStream(income({ text: 'Refund from tcsgrocers' }), [stream({ source: 'TCS' })]),
    ).toBeNull();
  });

  it('ignores a stream the user has switched off', () => {
    expect(matchSalaryStream(income(), [stream({ active: false })])).toBeNull();
  });

  it('refuses to choose between two streams both due and both unnamed', () => {
    expect(
      matchSalaryStream(income({ text: 'Salary' }), [
        stream({ id: 'a', source: 'Infosys' }),
        stream({ id: 'b', source: 'Google' }),
      ]),
    ).toBeNull();
  });

  it('picks the stream the text actually names, even with another due', () => {
    const match = matchSalaryStream(income({ text: 'Infosys salary' }), [
      stream({ id: 'a', source: 'Infosys' }),
      stream({ id: 'b', source: 'Google' }),
    ]);
    expect(match?.stream.id).toBe('a');
  });

  it('ignores a zero or negative amount', () => {
    expect(matchSalaryStream(income({ amountPaise: 0 }), [stream()])).toBeNull();
    expect(matchSalaryStream(income({ amountPaise: -100 }), [stream()])).toBeNull();
  });

  it('survives an unparsable date on either side', () => {
    expect(matchSalaryStream(income({ at: new Date('nonsense') }), [stream()])).toBeNull();
    expect(matchSalaryStream(income(), [stream({ next_occurrence: 'nonsense' })])).toBeNull();
  });
});

describe('nextOccurrenceAfter', () => {
  it('moves one month on from the DUE date, not from the day it arrived', () => {
    const next = nextOccurrenceAfter(
      income({ at: new Date('2026-10-08T09:00:00Z') }),
      stream(),
    );
    expect(next.slice(0, 10)).toBe('2026-11-10');
  });

  it('keeps a month-end stream at month-end instead of drifting into March', () => {
    const next = nextOccurrenceAfter(
      income({ at: new Date('2026-01-31T09:00:00Z') }),
      stream({ next_occurrence: '2026-01-31T00:00:00Z', anchor_day: 31 }),
    );
    expect(next.slice(0, 10)).toBe('2026-02-28');
  });

  it('keeps advancing until the next payday is in the future', () => {
    const next = nextOccurrenceAfter(
      income({ at: new Date('2026-12-20T09:00:00Z') }),
      stream(),
    );
    expect(next.slice(0, 10)).toBe('2027-01-10');
  });

  it('advances a weekly stream by a week', () => {
    const next = nextOccurrenceAfter(
      income({ at: new Date('2026-10-10T09:00:00Z') }),
      stream({ frequency: 'weekly' }),
    );
    expect(next.slice(0, 10)).toBe('2026-10-17');
  });
});
