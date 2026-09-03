import { describe, it, expect } from 'vitest';
import { formatMonetaryCompact, formatMonetaryValue } from './money';

describe('formatMonetaryCompact', () => {
  it('drops the paise that were pushing summary figures off the edge', () => {
    expect(formatMonetaryValue(400000)).toBe('₹4,000.00');
    expect(formatMonetaryCompact(400000)).toBe('₹4,000');
  });

  it('uses Indian digit grouping', () => {
    expect(formatMonetaryCompact(58000000)).toBe('₹5,80,000');
    expect(formatMonetaryCompact(2500000)).toBe('₹25,000');
  });

  it('rounds rather than truncating', () => {
    expect(formatMonetaryCompact(9960)).toBe('₹100');
    expect(formatMonetaryCompact(9940)).toBe('₹99');
  });

  it('handles zero and negatives', () => {
    expect(formatMonetaryCompact(0)).toBe('₹0');
    expect(formatMonetaryCompact(-329900)).toBe('-₹3,299');
  });

  it('honours a non-INR currency', () => {
    expect(formatMonetaryCompact(400000, 'USD')).toBe('USD 4,000');
  });

  it('rejects a non-integer amount rather than rendering nonsense', () => {
    expect(() => formatMonetaryCompact(1.5)).toThrow();
  });

  it('is always at least as short as the full format', () => {
    for (const p of [0, 100, 9999, 400000, 58000000, 123456789]) {
      expect(formatMonetaryCompact(p).length).toBeLessThanOrEqual(formatMonetaryValue(p).length);
    }
  });
});
