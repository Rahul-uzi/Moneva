/**
 * Reading a bank SMS into something the app could record.
 *
 * Pure on purpose. No permissions, no Android, no network - just text in and a
 * proposal out - so the risky half of SMS import can be built and tested long
 * before anyone is asked to grant `READ_SMS`.
 *
 * Two rules shape everything here:
 *
 *   1. **Refuse before you guess.** A message that is not clearly a completed
 *      transaction returns null. Banks send OTPs, offers, balance replies,
 *      failures and collect-requests from the same sender IDs as real debits,
 *      and a wrong figure in a balance is worse than a missed one.
 *   2. **Formats are data, not code.** Banks change their templates without
 *      notice, so the shapes live in one table below. A new bank is a row.
 *
 * The patterns below are written against the STRUCTURE Indian bank messages
 * commonly take. They have not been validated against real messages from a
 * real inbox, and they should be before this is trusted with anyone's money.
 */

export type SmsKind = 'debit' | 'credit';

export interface ParsedSms {
  kind: SmsKind;
  /** Integer minor units, as everything else in the app carries them. */
  amountPaise: number;
  /** The digits the bank named for the account or card, when it named any. */
  accountTail?: string;
  /** The other party, when the message names one. */
  merchant?: string;
  /** The bank's own reference. The natural idempotency key. */
  reference?: string;
  /** Which rule matched, so a bad reading can be traced to one line. */
  matchedBy: string;
}

/**
 * Messages that must never become a transaction, checked before anything else.
 * Each one is a real way an inbox lies to a naive parser.
 */
const REFUSE: Array<{ id: string; test: RegExp; unless?: RegExp }> = [
  // A code is not money, and OTP messages carry amounts distressingly often.
  { id: 'otp', test: /\b(otp|one[\s-]?time\s?password|verification code|do not share)\b/i },
  // Nothing moved.
  { id: 'failed', test: /\b(failed|declined|unsuccessful|could not be processed|rejected)\b/i },
  // Someone is ASKING. Money has not moved yet.
  { id: 'request', test: /\b(requested money|collect request|payment request|requesting)\b/i },
  // A statement of position, not an event - unless the same message also
  // reports a movement, which most real debit alerts do before quoting the
  // balance they leave behind.
  {
    id: 'balance-enquiry',
    test: /\b(available balance|avl bal|balance enquiry|closing balance)\b/i,
    unless: /\b(debited|credited|spent|withdrawn|paid|sent to|transferred to)\b/i,
  },
  // Marketing that quotes a number.
  { id: 'promotional', test: /\b(offer|pre-?approved|apply now|click|download|eligible for|loan up to|cashback up to)\b/i },
  // A reversal undoes something that may never have been recorded; it needs a
  // person to look, not a second entry.
  { id: 'reversal', test: /\b(reversed|reversal|charge ?back)\b/i },
  // Scheduled, not settled.
  { id: 'upcoming', test: /\b(will be debited|due on|scheduled for|is due)\b/i },
];

/**
 * Ordered: the first rule that matches wins, so put the specific ones first.
 *
 * The verbs further down are written from the BANK's point of view and say
 * nothing about which end of the payment you are on. "Rahul paid you Rs.80"
 * contains "paid", and read by the generic rule it became an expense - money
 * arriving was subtracted from the balance instead of added to it. So the
 * rules that identify WHO received the money are settled first, before any
 * bare verb is consulted.
 */
const DIRECTION: Array<{ id: string; kind: SmsKind; test: RegExp }> = [
  // Someone paid YOU. This has to outrank `spent` below, which owns "paid".
  { id: 'paid-you', kind: 'credit', test: /\b(?:paid|sent|transferred)\s+(?:it\s+)?(?:to\s+)?you\b/i },
  // A refund is money coming back, and its message nearly always names the
  // debit it reverses - which `debited` would otherwise win on.
  // The gap is bounded by distance, not by "no full stop between them": an
  // amount is written "Rs.999", so a sentence-bounded gap could never reach
  // across one and this rule silently never fired.
  { id: 'refund', kind: 'credit', test: /\brefund(?:ed)?\b[\s\S]{0,60}\bcredited\b/i },

  { id: 'debited', kind: 'debit', test: /\bdebited\b/i },
  { id: 'credited', kind: 'credit', test: /\bcredited\b/i },
  // "used for" is how a card alert says it was spent.
  { id: 'spent', kind: 'debit', test: /\b(spent|paid|withdrawn|purchase of|used for)\b/i },
  // "Sent Rs.250.00 From A/C x1234 To SWIGGY" - the verb and its preposition
  // are separated by the amount, so "sent to" as one phrase never matched it.
  { id: 'sent', kind: 'debit', test: /\b(?:sent|transferred)\s+(?:rs\.?|inr|₹)?[\s0-9.,]*(?:from|to)\b/i },
  { id: 'received', kind: 'credit', test: /\b(received|deposited)\b/i },
  // Last, so "Payment of Rs.80 received from Rahul" is read by `received`.
  { id: 'payment-of', kind: 'debit', test: /\bpayment of\b/i },
];

/**
 * The amount, tried in order of how certain each shape is.
 *
 * Only the first form existed, and it requires the unit to LEAD. SBI's UPI
 * alert ("A/C X1234 debited by 250.0") names no unit at all and was dropped
 * entirely - direction read correctly, then no amount, then null.
 *
 * The last pattern is anchored to the verb on purpose. A bare number pattern
 * would happily read the "26" out of a date or the digits of a reference as
 * the amount; requiring "debited"/"credited" immediately before it means the
 * only number it can reach is the one the verb is talking about.
 */
const AMOUNT_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: 'prefixed', re: /(?:rs\.?|inr|₹)\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i },
  { id: 'suffixed', re: /\b([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s?(?:rs\b|inr\b|₹)/i },
  {
    id: 'after-verb',
    re: /\b(?:debited|credited|withdrawn|deposited)\s+(?:by|with|for)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b/i,
  },
];

const ACCOUNT_TAIL = /(?:a\/c|ac|acct|account|card)\s*(?:no\.?|ending|xx+)?\s*[xX*]*([0-9]{3,6})\b/i;

const REFERENCE = /(?:upi(?:\/| )?ref(?:erence)?(?: no\.?)?|ref(?:erence)?(?: no\.?)?|txn(?: id)?|transaction id|imps ref)\s*[:.# ]?\s*([A-Za-z0-9]{4,25})\b/i;

/** `to SWIGGY on`, `at BIG BAZAAR`, `from RAHUL` - the counterparty. */
const MERCHANT = /\b(?:to|at|from)\s+([A-Z][A-Za-z0-9&.'\- ]{2,40}?)(?=\s+(?:on|via|ref|upi|a\/c|dated|txn)\b|[.,]|$)/;

/**
 * Rupees as written by a bank into integer paise, without touching a float.
 *
 * `parseFloat('1234.56') * 100` is 123455.99999999999, and rounding that is a
 * coin flip the app should not be taking with someone's balance.
 */
export function rupeesToPaise(text: string): number | null {
  const cleaned = text.replace(/,/g, '').trim();
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(cleaned)) return null;

  const [whole, fraction = ''] = cleaned.split('.');
  const paise = fraction.padEnd(2, '0');
  const value = Number(whole) * 100 + Number(paise);

  return Number.isSafeInteger(value) ? value : null;
}

/** Why a message was refused, or null if it was not. */
export function refusalReason(body: string): string | null {
  for (const rule of REFUSE) {
    if (!rule.test.test(body)) continue;
    // A rule can be overruled by the rest of the message.
    if (rule.unless && rule.unless.test(body)) continue;
    return rule.id;
  }
  return null;
}

/**
 * A completed transaction, or null.
 *
 * Null is the common case and the correct one: most of an inbox is not a
 * transaction, and this would rather miss one than invent one.
 */
export function parseTransactionSms(body: string): ParsedSms | null {
  if (typeof body !== 'string' || body.trim() === '') return null;
  if (refusalReason(body)) return null;

  const direction = DIRECTION.find((rule) => rule.test.test(body));
  if (!direction) return null;

  let amountPaise: number | null = null;
  for (const pattern of AMOUNT_PATTERNS) {
    const match = pattern.re.exec(body);
    if (!match) continue;
    const paise = rupeesToPaise(match[1]);
    // A pattern that matched but produced nothing usable does not end the
    // search - the next shape may still read the same message correctly.
    if (paise !== null && paise !== 0) {
      amountPaise = paise;
      break;
    }
  }
  if (amountPaise === null) return null;

  const parsed: ParsedSms = {
    kind: direction.kind,
    amountPaise,
    matchedBy: direction.id,
  };

  const tail = ACCOUNT_TAIL.exec(body);
  if (tail) parsed.accountTail = tail[1];

  const reference = REFERENCE.exec(body);
  if (reference) parsed.reference = reference[1];

  const merchant = MERCHANT.exec(body);
  if (merchant) parsed.merchant = merchant[1].trim();

  return parsed;
}
