import { describe, it, expect } from 'vitest';
import { nowForDateTimeInput, parseApiDate } from './datetime';

describe('nowForDateTimeInput', () => {
  it('formats a date in local time, not UTC', () => {
    // The bug: toISOString() is UTC, but the input renders its value as local,
    // so every form opened at the device's UTC offset in the past.
    const d = new Date(2026, 8, 2, 23, 52); // 2 Sep 2026, 23:52 local
    expect(nowForDateTimeInput(d)).toBe('2026-09-02T23:52');
  });

  it('zero-pads single digit parts', () => {
    expect(nowForDateTimeInput(new Date(2026, 0, 5, 9, 7))).toBe('2026-01-05T09:07');
  });

  it('defaults to now', () => {
    const out = nowForDateTimeInput();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(out.slice(0, 4)).toBe(String(new Date().getFullYear()));
  });
});

describe('parseApiDate', () => {
  it('reads an offset-less timestamp as UTC', () => {
    // SQLite returns naive UTC. Left to `new Date()` the browser calls it local.
    const d = parseApiDate('2026-09-02T18:21:40.650000');
    expect(d.toISOString()).toBe('2026-09-02T18:21:40.650Z');
  });

  it('respects an explicit Z', () => {
    expect(parseApiDate('2026-09-02T18:21:40Z').toISOString()).toBe('2026-09-02T18:21:40.000Z');
  });

  it('respects a numeric offset', () => {
    // Postgres sends +00:00; a client could send +05:30.
    expect(parseApiDate('2026-09-02T23:51:40+05:30').toISOString()).toBe('2026-09-02T18:21:40.000Z');
    expect(parseApiDate('2026-09-02T18:21:40+00:00').toISOString()).toBe('2026-09-02T18:21:40.000Z');
  });

  it('passes a Date straight through', () => {
    const d = new Date(2026, 8, 2);
    expect(parseApiDate(d)).toBe(d);
  });

  it('round-trips what the app writes back', () => {
    // A form writes local -> toISOString (Z) -> API -> naive -> parseApiDate.
    const local = new Date(2026, 8, 2, 23, 52);
    const naiveFromApi = local.toISOString().replace('Z', '');
    expect(parseApiDate(naiveFromApi).getTime()).toBe(local.getTime());
  });

  it('keeps the same wall-clock the form will show', () => {
    const local = new Date(2026, 8, 2, 23, 52);
    const naiveFromApi = local.toISOString().replace('Z', '');
    expect(nowForDateTimeInput(parseApiDate(naiveFromApi))).toBe('2026-09-02T23:52');
  });
});
