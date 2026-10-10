import { localDateValue } from './moneySheets';

/**
 * Budget dates, in the person's own calendar.
 *
 * The budget sheet used `toISOString().split('T')[0]` for "the 1st" and "the
 * last day". In India local midnight on 1 October is 30 September 18:30 UTC,
 * so an October budget was saved as 30 Sep - 30 Oct and spending on 31 October
 * never counted against it. The server's own month (POST /budgets/plan) has
 * always been local midnight on the 1st to the last instant of the month;
 * these send exactly that.
 */

/** This month's first and last day, as date-input values, in local time. */
export const monthBounds = (now: Date): { start: string; end: string } => ({
  start: localDateValue(new Date(now.getFullYear(), now.getMonth(), 1)),
  end: localDateValue(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
});

const parts = (value: string) => {
  const [y, m, d] = value.split('-').map(Number);
  return [y, m - 1, d] as const;
};

/** The first instant of that local day, as the server stores it. */
export const dayStartIso = (value: string): string => {
  const [y, m, d] = parts(value);
  return new Date(y, m, d, 0, 0, 0, 0).toISOString();
};

/** The last instant of that local day - the end date counts in full. */
export const dayEndIso = (value: string): string => {
  const [y, m, d] = parts(value);
  return new Date(y, m, d, 23, 59, 59, 999).toISOString();
};

/** A stored instant as the local date it falls on, for the date input. */
export const isoToDateValue = (iso: string): string => localDateValue(new Date(iso));
