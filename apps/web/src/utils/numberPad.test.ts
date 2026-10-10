import { describe, expect, it } from 'vitest';
import { keyFromKeyboard, MAX_RUPEE_DIGITS, padDisplay, padToPaise, paiseToPad, pressKey, type PadKey } from './numberPad';

const type = (keys: string, start = ''): string =>
  [...keys].reduce((v, k) => pressKey(v, (k === '<' ? 'back' : k) as PadKey), start);

describe('pressing keys', () => {
  it('builds a number the way it is typed', () => {
    expect(type('4000')).toBe('4000');
    expect(type('12.5')).toBe('12.5');
  });

  it('never keeps a leading zero', () => {
    expect(type('05')).toBe('5');
    expect(type('0.5')).toBe('0.5');
  });

  it('starts a bare decimal point with a zero', () => {
    expect(type('.')).toBe('0.');
  });

  it('allows one decimal point and two places of paise', () => {
    expect(type('1..2')).toBe('1.2');
    expect(type('9.999')).toBe('9.99');
  });

  it('stops at an amount nobody records by hand', () => {
    expect(type('1234567890123')).toHaveLength(MAX_RUPEE_DIGITS);
  });

  it('deletes one character at a time, down to nothing', () => {
    expect(type('45<')).toBe('4');
    expect(type('4<<')).toBe('');
  });
});

describe('what the typed value is worth', () => {
  it('reads whole rupees and paise', () => {
    expect(padToPaise('4000')).toBe(400000);
    expect(padToPaise('12.5')).toBe(1250);
  });

  // A half-typed decimal must not throw mid-entry.
  it('reads nothing and half-typed values without complaint', () => {
    expect(padToPaise('')).toBe(0);
    expect(padToPaise('7.')).toBe(700);
    expect(padToPaise('0.')).toBe(0);
  });
});

describe('showing and prefilling', () => {
  it('groups digits the Indian way and keeps the user’s decimals', () => {
    expect(padDisplay('3150000')).toBe('31,50,000');
    expect(padDisplay('4000.5')).toBe('4,000.5');
    expect(padDisplay('')).toBe('0');
  });

  it('turns a stored amount back into what the pad would have typed', () => {
    expect(paiseToPad(3150000)).toBe('31500');
    expect(paiseToPad(1250)).toBe('12.50');
    expect(paiseToPad(0)).toBe('');
  });

  it('reads a physical keyboard too', () => {
    expect(keyFromKeyboard('7')).toBe('7');
    expect(keyFromKeyboard('Backspace')).toBe('back');
    expect(keyFromKeyboard(',')).toBe('.');
    expect(keyFromKeyboard('a')).toBeNull();
  });
});
