import { groupIndianDigits, paiseToRupeesString, rupeesToPaise } from './money';

/**
 * The rules behind MONEVA's own number pad.
 *
 * The pad replaces the phone keyboard for amounts: the system keyboard covered
 * half the sheet every time an amount was typed, and offered letters that an
 * amount can never contain. The value is held as the string the user has
 * typed - "4000", "12.5", "0." - and only turned into paise when it is used,
 * so a half-typed decimal is never rejected mid-entry.
 */

export type PadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back';

/** ₹99,99,99,999 - more than anyone records by hand, and safe in paise. */
export const MAX_RUPEE_DIGITS = 9;

export const pressKey = (value: string, key: PadKey): string => {
  if (key === 'back') return value.slice(0, -1);

  const dot = value.indexOf('.');

  if (key === '.') {
    if (dot !== -1) return value; // one decimal point only
    return value === '' ? '0.' : `${value}.`;
  }

  // A digit.
  if (dot !== -1) {
    // Paise stop at two places.
    return value.length - dot - 1 >= 2 ? value : value + key;
  }
  // No leading zeros: "0" then "5" is 5, not 05.
  if (value === '0') return key;
  if (value.length >= MAX_RUPEE_DIGITS) return value;
  return value + key;
};

/** What the typed value is worth. Empty and half-typed values are handled, never thrown. */
export const padToPaise = (value: string): number => {
  const clean = value.endsWith('.') ? value.slice(0, -1) : value;
  if (!clean) return 0;
  try {
    return rupeesToPaise(clean);
  } catch {
    return 0;
  }
};

/** The amount as it is shown: Indian grouping, the user's own decimals. */
export const padDisplay = (value: string): string => (value ? groupIndianDigits(value) : '0');

/** A stored amount, as the pad would have typed it: 3150000 -> "31500". */
export const paiseToPad = (paise: number): string => {
  if (!paise || paise <= 0) return '';
  const s = paiseToRupeesString(paise);
  return s.endsWith('.00') ? s.slice(0, -3) : s;
};

/** A physical key, for a phone with a keyboard attached or the web app. */
export const keyFromKeyboard = (key: string): PadKey | null => {
  if (/^[0-9]$/.test(key)) return key as PadKey;
  if (key === '.' || key === ',') return '.';
  if (key === 'Backspace' || key === 'Delete') return 'back';
  return null;
};
