import type { RecurringIncome } from '../types/api';
import { parseApiDate } from './datetime';

/** How many days one cycle of a stream covers. */
const CYCLE_DAYS: Record<string, number> = {
  weekly: 7,
  fortnightly: 14,
  biweekly: 14,
  monthly: 30,
  quarterly: 91,
  yearly: 365,
  annually: 365,
};

/**
 * One spelling per frequency. "bi-weekly" was saved by the old schedule screen
 * and recognised by nothing, so a fortnightly salary counted down a month.
 */
export const normaliseFrequency = (frequency: string | null | undefined): string =>
  String(frequency ?? 'monthly').toLowerCase().replace(/[\s_-]/g, '');

/** An unrecognised frequency is treated as monthly - the overwhelming case. */
export const cycleLengthDays = (frequency: string): number =>
  CYCLE_DAYS[normaliseFrequency(frequency)] ?? 30;

/**
 * How close a payday has to be before Home counts down to it. The user's
 * call: a month-long countdown that appears the day after payday says
 * nothing; the last fortnight is when "how long until I'm paid" matters.
 */
export const PAYDAY_COUNTDOWN_DAYS = 15;

export interface Payday {
  id: string;
  source: string;
  amountMinor: number;
  /** Whole days from today. 0 means it lands today. */
  daysAway: number;
  cycleDays: number;
  /** How far through the countdown we are, 0 to 1: empty when the card
   *  first appears, full on the day. */
  progress: number;
}

const MS_PER_DAY = 86400000;

/** Whole days between two instants, counted on calendar days rather than
 *  elapsed hours, so a payday at 09:00 tomorrow is one day away and not zero. */
export const daysBetween = (from: Date, to: Date): number => {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
};

/**
 * The next salary to land, or null if there is nothing to count down to.
 *
 * Anything already past is deliberately excluded: money that was due and never
 * recorded is the due-salary card's job, and a countdown showing a negative
 * number would be a second, contradictory answer to the same question.
 */
export function nextPayday(streams: RecurringIncome[], today: Date = new Date()): Payday | null {
  let best: Payday | null = null;

  for (const stream of streams) {
    if (!stream.active || !stream.next_occurrence) continue;

    const due = parseApiDate(stream.next_occurrence);
    if (Number.isNaN(due.getTime())) continue;

    const daysAway = daysBetween(today, due);
    if (daysAway < 0) continue;

    const cycleDays = cycleLengthDays(stream.frequency);
    // The arc spans the countdown, not the whole cycle - otherwise a monthly
    // salary's card would first appear already half full. A weekly one counts
    // down its own seven days. Clamped: a payday further out than the window
    // draws an empty arc rather than a negative one.
    const window = Math.min(cycleDays, PAYDAY_COUNTDOWN_DAYS);
    const progress = Math.min(1, Math.max(0, (window - daysAway) / window));

    if (best === null || daysAway < best.daysAway) {
      best = {
        id: stream.id,
        source: stream.source,
        amountMinor: stream.amount_minor,
        daysAway,
        cycleDays,
        progress,
      };
    }
  }

  return best;
}

/** How the countdown reads. Days are what people actually think in. */
export const describePayday = (daysAway: number): string => {
  if (daysAway === 0) return 'Today';
  if (daysAway === 1) return 'Tomorrow';
  return `${daysAway} days`;
};
