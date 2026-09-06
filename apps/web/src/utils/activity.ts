import { parseApiDate } from './datetime';

/**
 * Whether something arrived after the last time this device looked.
 *
 * A first-ever open has nothing to compare against, and marking the entire
 * list as new would be noise rather than news - so it marks nothing. Same for
 * a date the parser cannot make sense of: a marker that might be wrong is
 * worse than no marker.
 */
export function isNewSince(dateIso: string, since: string | null): boolean {
  if (!since) return false;

  const seen = parseApiDate(since).getTime();
  const at = parseApiDate(dateIso).getTime();
  if (Number.isNaN(seen) || Number.isNaN(at)) return false;

  return at > seen;
}

/** How many of these arrived since. Counts only what it was given. */
export function countNewSince(
  items: Array<{ transaction_date: string }>,
  since: string | null,
): number {
  return items.reduce((n, item) => (isNewSince(item.transaction_date, since) ? n + 1 : n), 0);
}
