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
 * Puts Indian digit grouping on an already-plain number string.
 *
 * "6500.00" becomes "6,500.00" and "1234567.89" becomes "12,34,567.89" - the
 * last three digits, then twos, which is how the figure is read aloud here and
 * so how it is recognised at a glance.
 *
 * Takes a string and returns one, never touching a float: a rupee amount can
 * exceed what a double represents exactly, and the point of keeping money in
 * paise is undone the moment it is converted to a Number to be displayed.
 */
export function groupIndianDigits(plain: string): string {
  const negative = plain.startsWith('-');
  const body = negative ? plain.slice(1) : plain;
  const dot = body.indexOf('.');
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const decPart = dot === -1 ? '' : body.slice(dot);

  let grouped = intPart;
  if (intPart.length > 3) {
    const last3 = intPart.slice(-3);
    let rest = intPart.slice(0, -3);
    const chunks: string[] = [];
    while (rest.length > 2) {
      chunks.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest) chunks.unshift(rest);
    grouped = chunks.join(',') + ',' + last3;
  }
  return (negative ? '-' : '') + grouped + decPart;
}

/** The same string with the grouping taken back off, ready to be parsed. */
export function ungroupDigits(text: string): string {
  return text.split(',').join('');
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

/** The parts of a formatted figure: sign, symbol, whole units, minor units. */
export interface MoneyParts {
  negative: boolean;
  symbol: string;
  major: string;
  minor: string;
}

/**
 * Splits what `formatMonetaryValue` produced back into its parts, so a figure
 * can be SET rather than merely printed - the symbol and the paise want their
 * own size and weight, and a mask needs to replace the digits without losing
 * the currency.
 *
 * Returns null for anything it does not recognise, so the caller can fall back
 * to the formatter's own string rather than dropping the amount.
 */
export function splitFormattedMoney(text: string): MoneyParts | null {
  const parts = /^(-?)([^\d]+)([\d,]+)\.(\d{2})$/.exec(text);
  if (!parts) return null;
  return { negative: parts[1] === '-', symbol: parts[2].trim(), major: parts[3], minor: parts[4] };
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

/**
 * Whole rupees for summary tiles, e.g. ₹4,000 and ₹5,80,000.
 *
 * The three-up planner card shows a figure per column, and at that width the
 * ".00" was enough to push the number past the edge and get it ellipsised -
 * "₹4,00…" tells the reader nothing. Paise carry no meaning in a total this
 * size, so they are dropped rather than the digits that matter.
 *
 * Rounds rather than truncating, so ₹99.60 reads as ₹100 and not ₹99.
 */
export function formatMonetaryCompact(valOrAmount: Paise | MonetaryValue, currency: string = 'INR'): string {
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
  const major = Math.round(Math.abs(paise) / 100);
  const symbol = curr === 'INR' ? '₹' : `${curr} `;

  return `${isNegative ? '-' : ''}${symbol}${new Intl.NumberFormat('en-IN').format(major)}`;
}
