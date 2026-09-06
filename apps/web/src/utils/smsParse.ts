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

/** Ordered: the first rule that matches wins, so put the specific ones first. */
const DIRECTION: Array<{ id: string; kind: SmsKind; test: RegExp }> = [
  { id: 'debited', kind: 'debit', test: /\bdebited\b/i },
  { id: 'credited', kind: 'credit', test: /\bcredited\b/i },
  { id: 'spent', kind: 'debit', test: /\b(spent|paid|withdrawn|purchase of)\b/i },
  { id: 'sent', kind: 'debit', test: /\b(sent to|transferred to|payment of)\b/i },
  { id: 'received', kind: 'credit', test: /\b(received|deposited)\b/i },
];

/** `Rs.1,234.56`, `INR 1234`, `₹1,234` - the amount and nothing else. */
const AMOUNT = /(?:rs\.?|inr|₹)\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;

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

  const amountMatch = AMOUNT.exec(body);
  if (!amountMatch) return null;

  const amountPaise = rupeesToPaise(amountMatch[1]);
  if (amountPaise === null || amountPaise === 0) return null;

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
