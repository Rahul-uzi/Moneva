import { describe, expect, it } from 'vitest';
import {
  cashAccountsOf,
  describeNext,
  everyLabel,
  localDateValue,
  looksLikeCash,
  nextSalaryDate,
  paydayFromDateValue,
  salaryAccountDefault,
  salaryStreamEffect,
  withdrawalSources,
} from './moneySheets';
import type { Account, RecurringIncome } from '../types/api';

const acc = (over: Partial<Account>): Account => ({
  id: 'a',
  user_id: 'u',
  name: 'Account',
  account_type: 'asset',
  currency: 'INR',
  opening_balance_minor: 0,
  is_active: true,
  created_at: '',
  updated_at: '',
  ...over,
});

const ACCOUNTS = [
  acc({ id: 'cash', name: 'Cash' }),
  acc({ id: 'card', name: 'Rewards Card', account_type: 'liability' }),
  acc({ id: 'bank', name: 'City Bank Savings' }),
  acc({ id: 'old', name: 'Closed Bank', is_active: false }),
  acc({ id: 'wallet', name: 'Pocket money' }),
];

describe('where a cash withdrawal comes from', () => {
  // The reported bug: "Out of" showed Cash. Cash into cash is not a withdrawal.
  it('never offers cash as the source', () => {
    const ids = withdrawalSources(ACCOUNTS).map((a) => a.id);
    expect(ids).not.toContain('cash');
    expect(ids).not.toContain('wallet');
  });

  it('puts banks before cards, and leaves closed accounts out', () => {
    expect(withdrawalSources(ACCOUNTS).map((a) => a.id)).toEqual(['bank', 'card']);
  });

  it('lands only in open cash-like asset accounts', () => {
    expect(cashAccountsOf(ACCOUNTS).map((a) => a.id)).toEqual(['cash', 'wallet']);
  });

  it('knows cash by the names people give it, as whole words', () => {
    expect(looksLikeCash({ name: 'Cash' })).toBe(true);
    expect(looksLikeCash({ name: 'my wallet' })).toBe(true);
    expect(looksLikeCash({ name: 'Cashback Card' })).toBe(false);
  });
});

const stream = (over: Partial<RecurringIncome> = {}): RecurringIncome => ({
  id: 's',
  user_id: 'u',
  source: 'Monthly Salary',
  amount_minor: 3150000,
  frequency: 'monthly',
  next_occurrence: '2026-10-10T03:30:00Z',
  anchor_day: 10,
  active: true,
  created_at: '',
  updated_at: '',
  ...over,
});

describe('the next payday after recording a salary', () => {
  // The drift this fixes: paid a day early, payday moved a day earlier, every
  // month it came early, until the 10th became the 5th.
  it('moves an existing stream on from the day it was due, not the day it came', () => {
    const next = nextSalaryDate(new Date(2026, 9, 9, 11, 0), 3150000, stream());
    expect(new Date(next).getDate()).toBe(10);
    expect(new Date(next).getMonth()).toBe(10); // November
  });

  it('starts a new stream a month after the money arrived', () => {
    const next = nextSalaryDate(new Date(2026, 9, 9, 11, 0), 3150000, undefined);
    expect(new Date(next).getDate()).toBe(9);
    expect(new Date(next).getMonth()).toBe(10);
  });

  it('keeps a month-end salary at month-end', () => {
    const next = nextSalaryDate(new Date(2026, 0, 31, 11, 0), 3150000, undefined);
    expect(new Date(next).getDate()).toBe(28); // February 2026
    expect(new Date(next).getMonth()).toBe(1);
  });
});

describe('describing the next payday', () => {
  const today = new Date(2026, 9, 10, 12, 0);

  it('counts calendar days ahead', () => {
    expect(describeNext(new Date(2026, 9, 13, 9).toISOString(), today)).toMatchObject({
      text: expect.stringMatching(/in 3 days$/), due: false,
    });
    expect(describeNext(new Date(2026, 9, 11, 9).toISOString(), today).text).toMatch(/tomorrow$/);
  });

  it('flags today and lateness, which is when "Received" matters', () => {
    expect(describeNext(new Date(2026, 9, 10, 9).toISOString(), today)).toMatchObject({ due: true });
    expect(describeNext(new Date(2026, 9, 8, 9).toISOString(), today).text).toMatch(/2 days late$/);
    expect(describeNext(new Date(2026, 9, 9, 9).toISOString(), today).text).toMatch(/1 day late$/);
  });
});

describe('dates for the schedule form', () => {
  it('formats from local parts, never through UTC', () => {
    // 00:30 on 1 Nov in India is still 31 Oct in UTC - toISOString got this wrong.
    expect(localDateValue(new Date(2026, 10, 1, 0, 30))).toBe('2026-11-01');
  });

  it('stores a payday at nine in the morning and carries its day', () => {
    const p = paydayFromDateValue('2026-10-31');
    expect(p?.day).toBe(31);
    expect(p?.at.getHours()).toBe(9);
    expect(p?.at.getDate()).toBe(31);
    expect(paydayFromDateValue('')).toBeNull();
  });

  it('labels every spelling of a fortnight the same way', () => {
    expect(everyLabel('bi-weekly')).toBe('Every 2 weeks');
    expect(everyLabel('biweekly')).toBe('Every 2 weeks');
    expect(everyLabel('monthly')).toBe('Every month');
  });
});

describe('what recording a salary does to its schedule', () => {
  const due10Nov = stream({ next_occurrence: new Date(2026, 10, 10, 9).toISOString() });

  it('starts a schedule when there is none', () => {
    expect(salaryStreamEffect(new Date(2026, 9, 10, 12), 1, undefined).action).toBe('create');
  });

  it('moves it on when the salary lands near its due date, early or late', () => {
    expect(salaryStreamEffect(new Date(2026, 10, 8, 12), 1, due10Nov)).toMatchObject({ action: 'advance' });
    expect(salaryStreamEffect(new Date(2026, 10, 13, 12), 1, due10Nov).action).toBe('advance');
    const next = new Date(salaryStreamEffect(new Date(2026, 10, 8, 12), 1, due10Nov).next);
    expect([next.getMonth(), next.getDate()]).toEqual([11, 10]); // 10 December
  });

  // Seen while designing the sheet: October already recorded, schedule on
  // 10 Nov, and recording anything on 10 Oct pushed it to 10 Dec - deleting
  // November's payday without a word.
  it('leaves it alone when the money comes weeks before it is due', () => {
    const effect = salaryStreamEffect(new Date(2026, 9, 10, 12), 1, due10Nov);
    expect(effect).toEqual({ action: 'keep', next: due10Nov.next_occurrence });
  });
});

describe('where a salary goes by default', () => {
  // Seen on screen: the salary sheet defaulted to Cash, because Cash came first.
  it('picks the first bank account, not cash, even when cash is listed first', () => {
    expect(salaryAccountDefault(ACCOUNTS)?.id).toBe('bank');
  });

  it('falls back to cash only when there is no bank', () => {
    expect(salaryAccountDefault([acc({ id: 'cash', name: 'Cash' })])?.id).toBe('cash');
    expect(salaryAccountDefault([])).toBeUndefined();
  });
});
