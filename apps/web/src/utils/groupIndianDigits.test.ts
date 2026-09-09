import { describe, it, expect } from 'vitest';
import {
  groupIndianDigits, ungroupDigits, rupeesToPaise, paiseToRupeesString,
} from './money';

/**
 * A number nobody has to count the digits of.
 *
 * An amount field that showed "6500" left the reader doing the arithmetic:
 * six thousand five hundred rupees, or sixty-five rupees typed in paise? The
 * answer only appeared once the row had been saved, which is the wrong moment
 * to find out. Grouping is what makes the figure legible at a glance, and in
 * India that is the last three digits and then twos - never the threes that
 * come free with Intl defaults.
 */

describe('reading a figure at a glance', () => {
  it('groups the last three digits, then in twos', () => {
    expect(groupIndianDigits('6500.00')).toBe('6,500.00');
    expect(groupIndianDigits('65000.00')).toBe('65,000.00');
    expect(groupIndianDigits('650000.00')).toBe('6,50,000.00');
    expect(groupIndianDigits('1234567.89')).toBe('12,34,567.89');
    expect(groupIndianDigits('123456789.00')).toBe('12,34,56,789.00');
  });

  it('leaves small numbers alone', () => {
    expect(groupIndianDigits('0.00')).toBe('0.00');
    expect(groupIndianDigits('45.00')).toBe('45.00');
    expect(groupIndianDigits('999.99')).toBe('999.99');
    expect(groupIndianDigits('1000.00')).toBe('1,000.00');
  });

  it('keeps the sign in front where it belongs', () => {
    expect(groupIndianDigits('-1234567.89')).toBe('-12,34,567.89');
    expect(groupIndianDigits('-500.00')).toBe('-500.00');
  });

  it('does not mind a number with no decimals', () => {
    expect(groupIndianDigits('6500')).toBe('6,500');
    expect(groupIndianDigits('1234567')).toBe('12,34,567');
  });
});

describe('taking the grouping back off', () => {
  it('gives back something the parser accepts', () => {
    // The parser is deliberately strict and rejects commas, so every read of
    // the field has to pass through this first.
    for (const plain of ['6500.00', '1234567.89', '999.99', '12.00']) {
      const grouped = groupIndianDigits(plain);
      expect(ungroupDigits(grouped)).toBe(plain);
      expect(() => rupeesToPaise(ungroupDigits(grouped))).not.toThrow();
    }
  });

  it('is harmless on text that was never grouped', () => {
    expect(ungroupDigits('6500.00')).toBe('6500.00');
    expect(ungroupDigits('')).toBe('');
  });
});

describe('the round trip the field actually performs', () => {
  it('returns the same paise it was given', () => {
    // What the amount field does on every blur: paise to text, grouped for
    // the eye, ungrouped and parsed back. A rupee lost anywhere in there is a
    // rupee lost from the ledger.
    for (const paise of [0, 1, 99, 100, 650000, 123456789, 99999999999]) {
      const shown = groupIndianDigits(paiseToRupeesString(paise));
      expect(rupeesToPaise(ungroupDigits(shown))).toBe(paise);
    }
  });

  it('holds for an amount too large for a float to hold exactly', () => {
    // The reason this works on strings and never on a Number. 90,071,992,547
    // rupees is past the point where a double keeps every paise, and routing
    // the display through one would silently round the ledger.
    const paise = 9007199254740993;
    expect(Number.isSafeInteger(paise)).toBe(false);
    // Not asserting a round trip through the parser here - the value is past
    // what it accepts - only that grouping itself invents no digits.
    const grouped = groupIndianDigits('90071992547409.93');
    expect(ungroupDigits(grouped)).toBe('90071992547409.93');
    expect(grouped).toBe('9,00,71,99,25,47,409.93');
  });
});
