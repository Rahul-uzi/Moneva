import type { RecurringIncome } from '../types/api';
import { parseApiDate } from './datetime';

/**
 * Is this income the salary the app is waiting for?
 *
 * WHY THIS EXISTS. Recording a salary only moved the stream forward along one
 * route: the "Confirm Salary Receipt" shortcut. Typing the same money into the
 * ordinary income form left the stream untouched, so the home screen kept
 * counting down to a payday that had already happened - and when that date
 * arrived it asked for a salary already sitting in the ledger. One tap from
 * recording the same month twice.
 *
 * Paid early is the normal case, not the exception: a company that pays on the
 * 10th pays on the 8th when the 10th is a Sunday. The window is therefore
 * generous in both directions.
 *
 * DELIBERATELY NOT MATCHED ON AMOUNT. A salary changes - a raise, a bonus
 * month, tax - so requiring the figure would miss exactly the months that
 * matter most. But an amount is no signal on its own either, or every large
 * credit near payday would be read as the salary. A NAMING signal is required;
 * the amount only ever colours the question that gets asked.
 *
 * AND IT ONLY EVER ASKS. Nothing here moves a payday by itself: a wrong match
 * would silently skip a month the user is still owed.
 */

export interface IncomeLike {
  amountPaise: number;
  /** When the money arrived. */
  at: Date;
  /** Whatever the row is called - source, description, or both. */
  text: string;
  /** The category it was filed under, if any. */
  categoryName?: string | null;
}

export interface SalaryMatch {
  stream: RecurringIncome;
  /** True when the figure differs from what the stream expects. */
  amountChanged: boolean;
}

/** Paid a little early or a little late is still this cycle's salary. */
export const EARLY_DAYS = 10;
export const LATE_DAYS = 12;

const DAY = 24 * 60 * 60 * 1000;
const squash = (s: string): string => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The row names this stream itself - the strongest thing on offer. */
const namesTheStream = (stream: RecurringIncome, income: IncomeLike): boolean => {
  const source = squash(stream.source);
  // Four characters, so a stream called "TCS" cannot match on three letters
  // that happen to sit inside an unrelated word.
  return source.length >= 4 && squash(income.text).includes(source);
};

/** The row says it is pay, without saying whose. */
const looksLikePay = (income: IncomeLike): boolean => {
  if ((income.categoryName || '').trim().toLowerCase() === 'salary') return true;
  return /\b(salary|payroll|wages|stipend)\b/i.test(income.text || '');
};

export const matchSalaryStream = (
  income: IncomeLike,
  streams: readonly RecurringIncome[],
): SalaryMatch | null => {
  if (!Number.isFinite(income.amountPaise) || income.amountPaise <= 0) return null;
  if (Number.isNaN(income.at.getTime())) return null;

  const dueNow = streams.filter((s) => {
    if (!s.active || !s.next_occurrence) return false;
    const at = parseApiDate(s.next_occurrence).getTime();
    if (Number.isNaN(at)) return false;
    const drift = (income.at.getTime() - at) / DAY;
    return drift >= -EARLY_DAYS && drift <= LATE_DAYS;
  });

  /* Named beats generic. Somebody with two salaries writes "Infosys salary",
     and the word "salary" fits both streams while the name fits only one - so
     the named one wins outright rather than the pair cancelling out. */
  const named = dueNow.filter((s) => namesTheStream(s, income));
  const candidates = named.length > 0 ? named : looksLikePay(income) ? dueNow : [];

  // Two streams due at once and nothing here can say which this was. Asking
  // about the wrong one is worse than not asking.
  if (candidates.length !== 1) return null;

  const stream = candidates[0];
  return { stream, amountChanged: stream.amount_minor !== income.amountPaise };
};

/** One cycle of this stream. Anything unrecognised is treated as monthly. */
const advanceOne = (from: Date, frequency: string, anchorDay: number): Date => {
  const next = new Date(from);
  let months: number;
  switch (String(frequency).trim().toLowerCase()) {
    case 'weekly':
      next.setDate(next.getDate() + 7);
      return next;
    case 'fortnightly':
    case 'biweekly':
      next.setDate(next.getDate() + 14);
      return next;
    case 'quarterly':
      months = 3;
      break;
    case 'yearly':
    case 'annually':
      months = 12;
      break;
    default:
      months = 1;
      break;
  }

  /* The month is moved by ARITHMETIC, not by setMonth on the current day.
     setMonth keeps the day while changing the month, so 31 January plus one
     month is 3 March - already past February by the time anything could clamp
     it, which turned a stream anchored to month-end into 31 March. The target
     month is worked out first and the day only placed afterwards. */
  const target = next.getMonth() + months;
  const year = next.getFullYear() + Math.floor(target / 12);
  const month = ((target % 12) + 12) % 12;
  const lastOfMonth = new Date(year, month + 1, 0).getDate();
  next.setFullYear(year, month, Math.min(anchorDay, lastOfMonth));
  return next;
};

/** The date the stream should point at once this one is settled. */
export const nextOccurrenceAfter = (income: IncomeLike, stream: RecurringIncome): string => {
  /* Counted from the DUE date, never from when the money happened to arrive.
     Anchoring to arrival walks payday later every month a salary lands late,
     until a stream set to the 10th is expecting the 20th. */
  const due = parseApiDate(stream.next_occurrence);
  const anchorDay = stream.anchor_day || due.getDate();

  let next = advanceOne(due, stream.frequency, anchorDay);
  // Recorded weeks late, the next one must still land in the future, or the
  // home screen would immediately report it overdue.
  for (let i = 0; i < 24 && next.getTime() <= income.at.getTime(); i += 1) {
    next = advanceOne(next, stream.frequency, anchorDay);
  }
  return next.toISOString();
};
