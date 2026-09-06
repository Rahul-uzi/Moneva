import { describe, it, expect } from 'vitest';
import { countNewSince, isNewSince } from './activity';

const tx = (transaction_date: string) => ({ transaction_date });

describe('isNewSince', () => {
  /* The first ever open has nothing to compare against. Marking the whole list
     new would be noise dressed as news. */
  it('marks nothing on a first ever open', () => {
    expect(isNewSince('2026-09-05T10:00:00Z', null)).toBe(false);
    expect(isNewSince('2026-09-05T10:00:00Z', '')).toBe(false);
  });

  it('marks what arrived after the last look', () => {
    expect(isNewSince('2026-09-05T12:00:00Z', '2026-09-05T10:00:00Z')).toBe(true);
  });

  it('leaves what was already there alone', () => {
    expect(isNewSince('2026-09-05T08:00:00Z', '2026-09-05T10:00:00Z')).toBe(false);
  });

  it('treats the exact instant of the last look as already seen', () => {
    expect(isNewSince('2026-09-05T10:00:00Z', '2026-09-05T10:00:00Z')).toBe(false);
  });

  /* A marker that might be wrong is worse than no marker. */
  it('says no rather than guessing when either date is unreadable', () => {
    expect(isNewSince('nonsense', '2026-09-05T10:00:00Z')).toBe(false);
    expect(isNewSince('2026-09-05T10:00:00Z', 'nonsense')).toBe(false);
  });
});

describe('countNewSince', () => {
  it('counts only what it was handed', () => {
    const rows = [
      tx('2026-09-05T12:00:00Z'),
      tx('2026-09-05T11:00:00Z'),
      tx('2026-09-04T09:00:00Z'),
    ];
    expect(countNewSince(rows, '2026-09-05T10:00:00Z')).toBe(2);
  });

  it('is zero for an empty list and for a first open', () => {
    expect(countNewSince([], '2026-09-05T10:00:00Z')).toBe(0);
    expect(countNewSince([tx('2026-09-05T12:00:00Z')], null)).toBe(0);
  });
});
