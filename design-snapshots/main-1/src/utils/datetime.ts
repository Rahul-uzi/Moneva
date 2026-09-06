/**
 * "now" formatted for a `datetime-local` input.
 *
 * `new Date().toISOString().slice(0, 16)` looks right but is UTC, while the
 * input renders whatever it is given as LOCAL time. On an IST device that
 * opened every form 5.5 hours in the past.
 */
export const nowForDateTimeInput = (date: Date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
};

/**
 * Parses a timestamp that came from the API.
 *
 * The backend stores UTC, but SQLite has no timezone type, so a transaction
 * comes back as a bare `2026-09-02T18:21:40.650000` with no `Z`. The ECMAScript
 * spec reads a date-time with no offset as LOCAL, so the browser turned 18:21
 * UTC into 18:21 IST - every stored time in the app was shown 5.5 hours early.
 *
 * Postgres (production) does send an offset, so both forms have to work: if the
 * string already carries `Z` or `+05:30` it is parsed as-is, otherwise it is
 * pinned to UTC.
 */
export const parseApiDate = (value: string | Date): Date => {
  if (value instanceof Date) return value;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim());
  return new Date(hasZone ? value : `${value.trim()}Z`);
};
