/* Date inputs (yyyy-mm-dd) and the instants they stand for, in local time.
   Moved out of EmiModal so that file exports only its component. */

/**
 * An ISO instant as the yyyy-mm-dd a date input wants, on the local calendar.
 *
 * Local rather than UTC, and it has to match the way `emiProgress` counts the
 * months, or the date shown is not the date the plan runs on. Read through
 * toISOString, a plan started on the 1st came back as the last day of the
 * previous month for any reader west of Greenwich - and then, saved again,
 * walked a day earlier each time it was edited.
 */
export const asDateInput = (iso: string): string => {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
};

/**
 * The yyyy-mm-dd from the input, as the instant the day began for this reader.
 *
 * Built from the parts rather than parsed from a string, so it cannot depend
 * on whether an engine reads a bare date as local or as UTC.
 */
export const fromDateInput = (value: string): string | null => {
  const [y, m, d] = value.split('-').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const at = new Date(y, m - 1, d);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
};
