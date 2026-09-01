/**
 * Money utilities for MONEVA.
 * All monetary calculations MUST use these utilities to prevent floating-point drift.
 * Authoritative currency amounts are stored and calculated strictly as integer minor units (paise for INR).
 */

export type Paise = number;

export interface MonetaryValue {
  amount: Paise; // Integer paise (e.g., 125050 representing ₹1,250.50)
  currency: string; // e.g. "INR"
}

/**
 * Validates whether a value is a finite safe integer suitable for monetary minor units.
 */
export function isSafeMonetaryInteger(val: unknown): val is number {
  return typeof val === 'number' && Number.isInteger(val) && Number.isSafeInteger(val);
}

/**
 * Converts a decimal currency input (string or integer number) into integer minor units (paise).
 * Uses direct string parsing of major and minor digits to completely avoid floating-point math.
 *
 * Examples:
 *   "100"     -> 10000
 *   "100.50"  -> 10050
 *   "0.50"    -> 50
 *   "1250.5"  -> 125050
 *   "0"       -> 0
 *
 * Rejects invalid strings such as "", "abc", "12.345", "1..50".
 */
export function rupeesToPaise(input: string | number): Paise {
  if (input === null || input === undefined) {
    throw new Error('Invalid monetary amount: input is missing');
  }

  const strInput = typeof input === 'number' ? input.toString() : input.trim();
  if (strInput.length === 0) {
    throw new Error('Invalid monetary amount: empty input');
  }

  // Regex strictly matches optional sign, integer major part, and optional 1 or 2 decimal digits
  const regex = /^([+-]?\d+)(\.(\d{1,2}))?$/;
  const match = strInput.match(regex);
  if (!match) {
    throw new Error(`Invalid monetary amount: "${input}"`);
  }

  const rawMajor = match[1];
  const minorDigits = match[3];

  const isNegative = rawMajor.startsWith('-');
  const majorAbsStr = isNegative || rawMajor.startsWith('+') ? rawMajor.slice(1) : rawMajor;

  const majorAbs = parseInt(majorAbsStr, 10);
  if (!Number.isSafeInteger(majorAbs)) {
    throw new Error('Monetary amount exceeds safe integer limit');
  }

  let minorAbs = 0;
  if (minorDigits !== undefined) {
    if (minorDigits.length === 1) {
      minorAbs = parseInt(minorDigits, 10) * 10;
    } else if (minorDigits.length === 2) {
      minorAbs = parseInt(minorDigits, 10);
    }
  }

  const totalPaiseAbs = majorAbs * 100 + minorAbs;
  if (!Number.isSafeInteger(totalPaiseAbs)) {
    throw new Error('Monetary amount exceeds safe integer limit');
  }

  return isNegative ? -totalPaiseAbs : totalPaiseAbs;
}

/**
 * Converts integer minor units (paise) into a clean decimal string ("1250.50") for form inputs.
 * Uses integer math and string padding without floating point division.
 */
export function paiseToRupeesString(paise: Paise): string {
  if (!isSafeMonetaryInteger(paise)) {
    throw new Error(`Invalid monetary amount: "${paise}" is not a safe integer`);
  }

  const isNegative = paise < 0;
  const absPaise = Math.abs(paise);
  const major = Math.floor(absPaise / 100);
  const minor = absPaise % 100;
  const minorStr = minor.toString().padStart(2, '0');

  return `${isNegative ? '-' : ''}${major}.${minorStr}`;
}

/**
 * Formats integer minor units (paise) into a human-readable display string.
 * Uses Indian numbering format (e.g., ₹1,250.50). DISPLAY ONLY.
 */
export function formatMonetaryValue(valOrAmount: Paise | MonetaryValue, currency: string = 'INR'): string {
  let paise: Paise;
  let curr = currency;

  if (typeof valOrAmount === 'object' && valOrAmount !== null) {
    paise = valOrAmount.amount;
    curr = valOrAmount.currency || 'INR';
  } else {
    paise = valOrAmount;
  }

  if (!isSafeMonetaryInteger(paise)) {
    throw new Error(`Invalid monetary amount: "${paise}" is not a safe integer`);
  }

  const isNegative = paise < 0;
  const absPaise = Math.abs(paise);
  const major = Math.floor(absPaise / 100);
  const minor = absPaise % 100;
  const minorStr = minor.toString().padStart(2, '0');

  const formattedMajor = new Intl.NumberFormat('en-IN').format(major);
  const symbol = curr === 'INR' ? '₹' : `${curr} `;

  return `${isNegative ? '-' : ''}${symbol}${formattedMajor}.${minorStr}`;
}

/**
 * Safely adds two monetary values of the same currency using integer minor unit arithmetic.
 */
export function addMoney(a: MonetaryValue, b: MonetaryValue): MonetaryValue {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: Cannot add ${a.currency} and ${b.currency}`);
  }
  if (!isSafeMonetaryInteger(a.amount) || !isSafeMonetaryInteger(b.amount)) {
    throw new Error('Invalid monetary amount: inputs must be safe integers');
  }

  const sum = a.amount + b.amount;
  if (!isSafeMonetaryInteger(sum)) {
    throw new Error('Monetary overflow: sum exceeds safe integer limit');
  }

  return {
    amount: sum,
    currency: a.currency,
  };
}

/**
 * Safely subtracts monetary value b from a of the same currency using integer minor unit arithmetic.
 */
export function subtractMoney(a: MonetaryValue, b: MonetaryValue): MonetaryValue {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: Cannot subtract ${a.currency} and ${b.currency}`);
  }
  if (!isSafeMonetaryInteger(a.amount) || !isSafeMonetaryInteger(b.amount)) {
    throw new Error('Invalid monetary amount: inputs must be safe integers');
  }

  const diff = a.amount - b.amount;
  if (!isSafeMonetaryInteger(diff)) {
    throw new Error('Monetary overflow: difference exceeds safe integer limit');
  }

  return {
    amount: diff,
    currency: a.currency,
  };
}
