import { describe, it, expect } from 'vitest';
import { formatMonetaryValue, splitFormattedMoney } from './money';

/**
 * The split is what lets a figure be SET rather than printed - the symbol and
 * the paise take their own size, and hiding a balance replaces the digits
 * without losing the currency. Everything downstream of it renders wrongly, or
 * leaks a figure that was meant to be masked, if it gets a part wrong.
 */
describe('splitFormattedMoney', () => {
  it('splits what the formatter produced, for the currency the app uses', () => {
    expect(splitFormattedMoney(formatMonetaryValue(16334300))).toEqual({
      negative: false,
      symbol: '\u20b9',
      major: '1,63,343',
      minor: '00',
    });
  });

  it('keeps the paise rather than rounding them away', () => {
    expect(splitFormattedMoney(formatMonetaryValue(125050))?.minor).toBe('50');
  });

  it('reports a negative separately, so the sign can be dropped when masking', () => {
    const parts = splitFormattedMoney(formatMonetaryValue(-123000));
    expect(parts?.negative).toBe(true);
    expect(parts?.major).toBe('1,230');
  });

  it('handles a currency whose symbol is a word', () => {
    expect(splitFormattedMoney(formatMonetaryValue(500000, 'USD'))).toEqual({
      negative: false,
      symbol: 'USD',
      major: '5,000',
      minor: '00',
    });
  });

  it('returns null rather than a wrong split for anything unrecognised', () => {
    expect(splitFormattedMoney('')).toBeNull();
    expect(splitFormattedMoney('1234')).toBeNull();
    expect(splitFormattedMoney('\u20b912,345')).toBeNull();
  });

  it('survives the smallest and largest figures the app can hold', () => {
    expect(splitFormattedMoney(formatMonetaryValue(1))).toEqual({
      negative: false,
      symbol: '\u20b9',
      major: '0',
      minor: '01',
    });
    expect(splitFormattedMoney(formatMonetaryValue(999999999999))?.major).toBe('9,99,99,99,999');
  });
});
