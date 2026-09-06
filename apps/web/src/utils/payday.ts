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

/** An unrecognised frequency is treated as monthly - the overwhelming case. */
export const cycleLengthDays = (frequency: string): number =>
  CYCLE_DAYS[String(frequency).trim().toLowerCase()] ?? 30;

export interface Payday {
  id: string;
  source: string;
  amountMinor: number;
  /** Whole days from today. 0 means it lands today. */
  daysAway: number;
  cycleDays: number;
  /** How far through the cycle we are, 0 to 1. */
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
    // A payday further out than its own cycle means the stream is anchored
    // oddly; clamp rather than report a negative share of the cycle elapsed.
    const progress = Math.min(1, Math.max(0, (cycleDays - daysAway) / cycleDays));

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
