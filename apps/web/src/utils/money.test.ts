import { describe, it, expect } from 'vitest';
import {
  rupeesToPaise,
  paiseToRupeesString,
  formatMonetaryValue,
  addMoney,
  subtractMoney,
  isSafeMonetaryInteger,
} from './money';

describe('Money Utility - Hardened Integer Arithmetic', () => {
  describe('rupeesToPaise - Direct String Parsing', () => {
    it('correctly converts valid decimal strings to integer minor units (paise)', () => {
      expect(rupeesToPaise('100')).toBe(10000);
      expect(rupeesToPaise('100.50')).toBe(10050);
      expect(rupeesToPaise('0.50')).toBe(50);
      expect(rupeesToPaise('1250.5')).toBe(125050);
      expect(rupeesToPaise('0')).toBe(0);
      expect(rupeesToPaise('0.05')).toBe(5);
    });

    it('handles numeric input by converting to string', () => {
      expect(rupeesToPaise(100)).toBe(10000);
      expect(rupeesToPaise(0)).toBe(0);
    });

    it('rejects malformed and invalid inputs by throwing an error', () => {
      expect(() => rupeesToPaise('')).toThrow('empty input');
      expect(() => rupeesToPaise('   ')).toThrow('empty input');
      expect(() => rupeesToPaise('abc')).toThrow('Invalid monetary amount');
      expect(() => rupeesToPaise('12.345')).toThrow('Invalid monetary amount');
      expect(() => rupeesToPaise('1..50')).toThrow('Invalid monetary amount');
      expect(() => rupeesToPaise(null as unknown as string)).toThrow('missing');
      expect(() => rupeesToPaise(undefined as unknown as string)).toThrow('missing');
    });
  });

  describe('paiseToRupeesString - Decimal Display String', () => {
    it('converts integer paise to exact 2-decimal string for input fields', () => {
      expect(paiseToRupeesString(125050)).toBe('1250.50');
      expect(paiseToRupeesString(85000)).toBe('850.00');
      expect(paiseToRupeesString(50)).toBe('0.50');
      expect(paiseToRupeesString(0)).toBe('0.00');
    });

    it('rejects non-integer and unsafe integer values', () => {
      expect(() => paiseToRupeesString(1250.5)).toThrow('not a safe integer');
      expect(() => paiseToRupeesString(NaN)).toThrow('not a safe integer');
    });
  });

  describe('formatMonetaryValue - Display Only Formatting', () => {
    it('formats integer minor units into Indian locale currency strings', () => {
      expect(formatMonetaryValue(125050)).toBe('₹1,250.50');
      expect(formatMonetaryValue(85000)).toBe('₹850.00');
      expect(formatMonetaryValue(0)).toBe('₹0.00');
      expect(formatMonetaryValue({ amount: 125050, currency: 'INR' })).toBe('₹1,250.50');
    });

    it('rejects invalid or floating point paise values', () => {
      expect(() => formatMonetaryValue(12.5)).toThrow('not a safe integer');
    });
  });

  describe('addMoney & subtractMoney - Integer Arithmetic Only', () => {
    it('correctly adds monetary values of matching currency', () => {
      const a = { amount: 10000, currency: 'INR' };
      const b = { amount: 5000, currency: 'INR' };
      const result = addMoney(a, b);
      expect(result).toEqual({ amount: 15000, currency: 'INR' });
    });

    it('correctly subtracts monetary values of matching currency', () => {
      const a = { amount: 10000, currency: 'INR' };
      const b = { amount: 2500, currency: 'INR' };
      const result = subtractMoney(a, b);
      expect(result).toEqual({ amount: 7500, currency: 'INR' });
    });

    it('throws error on currency mismatch', () => {
      const inr = { amount: 10000, currency: 'INR' };
      const usd = { amount: 10000, currency: 'USD' };
      expect(() => addMoney(inr, usd)).toThrow('Currency mismatch');
      expect(() => subtractMoney(inr, usd)).toThrow('Currency mismatch');
    });

    it('validates safe integer boundaries', () => {
      expect(isSafeMonetaryInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
      expect(isSafeMonetaryInteger(125.45)).toBe(false);
      expect(isSafeMonetaryInteger(NaN)).toBe(false);
    });
  });
});
