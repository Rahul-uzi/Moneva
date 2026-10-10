import type { Account, RecurringIncome } from '../types/api';
import { parseApiDate } from './datetime';
import { daysBetween, normaliseFrequency } from './payday';
import { EARLY_DAYS, nextOccurrenceAfter } from './salaryMatch';

/**
 * The thinking behind the Cash withdrawal, Add salary and Salary schedule
 * sheets, kept out of the components so it can be tested without rendering.
 */

/** Anything that holds physical cash, by the name people give it. */
export const looksLikeCash = (a: Pick<Account, 'name'>): boolean =>
  /\b(cash|wallet|pocket|purse)\b/i.test(a.name);

/**
 * Where a cash withdrawal can come out of: banks first, then cards.
 *
 * NEVER cash itself. "Out of" used to list every account, cash included, so
 * it could read "Cash" - and cash into cash is not a withdrawal.
 */
export const withdrawalSources = (accounts: Account[]): Account[] =>
  accounts
    .filter((a) => a.is_active !== false && !looksLikeCash(a))
    .sort((a, b) => (a.account_type === b.account_type ? 0 : a.account_type === 'asset' ? -1 : 1));

/** Where withdrawn cash can land. */
export const cashAccountsOf = (accounts: Account[]): Account[] =>
  accounts.filter((a) => a.is_active !== false && a.account_type === 'asset' && looksLikeCash(a));

/**
 * Where a salary goes unless the user says otherwise: the first BANK account.
 *
 * The salary sheet took whichever account came first, which could be Cash -
 * the same mistake as the withdrawal sheet's "Out of", in the other direction.
 * Employers pay into banks; cash and cards are only a fallback for someone
 * who has nothing else.
 */
export const salaryAccountDefault = (accounts: Account[]): Account | undefined => {
  const open = accounts.filter((a) => a.is_active !== false);
  return (
    open.find((a) => a.account_type === 'asset' && !looksLikeCash(a)) ??
    open.find((a) => a.account_type === 'asset') ??
    open[0]
  );
};

/** A blank salary source is still saved, and matched, under the name it always had. */
export const DEFAULT_SALARY_SOURCE = 'Monthly Salary';

/**
 * When a salary stream should next expect money, once this one is recorded.
 *
 * An EXISTING stream moves on from the day it was DUE, not the day the money
 * arrived. The salary sheet used to add a month to the arrival date, so a
 * salary paid a day early moved payday a day earlier - and again the next time
 * - until a stream set for the 10th was expecting the 5th.
 *
 * A NEW stream has no due date yet, so it starts from the day this one came.
 */
export const nextSalaryDate = (
  received: Date,
  amountPaise: number,
  existing: RecurringIncome | undefined,
): string => {
  const income = { amountPaise, at: received, text: '' };
  if (existing) return nextOccurrenceAfter(income, existing);
  return nextOccurrenceAfter(income, {
    id: 'new',
    user_id: '',
    source: '',
    amount_minor: amountPaise,
    frequency: 'monthly',
    next_occurrence: received.toISOString(),
    anchor_day: received.getDate(),
    active: true,
    created_at: '',
    updated_at: '',
  });
};

/**
 * What recording a salary does to its schedule.
 *
 * Moving the schedule on is right only when this IS the payment it was
 * waiting for. Seen while designing the sheet: with October's salary already
 * recorded, the schedule pointed at 10 November - and recording anything
 * under the same name moved it to 10 DECEMBER, silently deleting November's
 * payday. A payment that lands well before the due date (more than the same
 * ten days early the "+" sheet allows) is a bonus, an arrear or a second job,
 * not next month's salary, so the schedule is left where it is.
 */
export type SalaryStreamEffect =
  | { action: 'create'; next: string }
  | { action: 'advance'; next: string }
  | { action: 'keep'; next: string };

const DAY_MS = 24 * 60 * 60 * 1000;

export const salaryStreamEffect = (
  received: Date,
  amountPaise: number,
  existing: RecurringIncome | undefined,
): SalaryStreamEffect => {
  if (!existing) return { action: 'create', next: nextSalaryDate(received, amountPaise, undefined) };
  const due = parseApiDate(existing.next_occurrence).getTime();
  const daysEarly = (due - received.getTime()) / DAY_MS;
  if (daysEarly > EARLY_DAYS) return { action: 'keep', next: existing.next_occurrence };
  return { action: 'advance', next: nextSalaryDate(received, amountPaise, existing) };
};

/**
 * The frequencies the schedule sheet offers, in the one spelling everything
 * reads. It used to save "bi-weekly", which nothing recognised.
 */
export const FREQUENCIES: Array<{ value: string; label: string; every: string }> = [
  { value: 'monthly', label: 'Monthly', every: 'Every month' },
  { value: 'biweekly', label: 'Every 2 weeks', every: 'Every 2 weeks' },
  { value: 'weekly', label: 'Weekly', every: 'Every week' },
];

export const everyLabel = (frequency: string): string =>
  FREQUENCIES.find((f) => f.value === normaliseFrequency(frequency))?.every ?? 'Every month';

/** "Due today", "in 3 days", "2 days late" - what a person wants from a date. */
export const describeNext = (iso: string, today: Date = new Date()): { text: string; due: boolean } => {
  const when = parseApiDate(iso);
  const days = daysBetween(today, when);
  const date = when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  if (days < 0) return { text: `Due ${date} · ${-days} day${days === -1 ? '' : 's'} late`, due: true };
  if (days === 0) return { text: `Due today · ${date}`, due: true };
  if (days === 1) return { text: `Next ${date} · tomorrow`, due: false };
  return { text: `Next ${date} · in ${days} days`, due: false };
};

/** "YYYY-MM-DD" from LOCAL date parts. toISOString() is a day early in India. */
export const localDateValue = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * A date-input value as the moment a payday is stored at: nine in the morning,
 * local. The date then stays the same in UTC for any user east of London, and
 * the day of the month travels separately so the 31st is never read as the 30th.
 */
export const paydayFromDateValue = (value: string): { at: Date; day: number } | null => {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { at: new Date(y, m - 1, d, 9, 0, 0), day: d };
};
