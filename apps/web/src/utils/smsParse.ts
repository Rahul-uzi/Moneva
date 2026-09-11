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

/**
 * `transfer` is money that MOVED without being SPENT.
 *
 * Own-account moves, ATM cash, wallet top-ups, paying your own credit-card
 * bill. Every app in this category books these as spending, and it is the
 * third-loudest complaint about all of them: it inflates reported spending and
 * corrupts every budget and category percentage, on exactly the largest
 * amounts a person moves. Cash taken from an ATM has not been spent - it is in
 * your pocket. A card bill is already an expense; paying it is not a second one.
 */
export type SmsKind = 'debit' | 'credit' | 'transfer';

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
  // ---- money that MOVED but was not SPENT -------------------------------
  // These sit at the top because every one of them contains a verb the rules
  // below would claim: an ATM withdrawal says "withdrawn", a card-bill payment
  // says "paid", a self-transfer says "transferred". Read by those rules they
  // all become spending.
  //
  // Each is deliberately narrow. Calling a real expense a transfer understates
  // spending and silently leaves room in a budget that should not be there -
  // which is worse than today's over-counting, because it is invisible. Where
  // a message is ambiguous these do NOT fire, and it stays an expense.

  // Both ends are yours: "from your A/c ... to your A/c". Requires the word
  // "your" on the destination, so paying someone else never matches.
  {
    id: 'self-transfer',
    kind: 'transfer',
    test: /\bfrom\s+your\s+[\s\S]{0,40}?\b(?:a\/c|acc(?:oun)?t|card)\b[\s\S]{0,60}?\bto\s+your\s+\b/i,
  },
  // Cash out of a machine. "ATM" must appear WITH the withdrawal verb - a shop
  // called "ATM Road Cafe" must not turn a purchase into a cash withdrawal.
  {
    id: 'atm-cash',
    kind: 'transfer',
    test: /\b(?:withdrawn|withdrawal|cash\s?w\/?d|wdl)\b[\s\S]{0,60}?\batm\b|\batm\b[\s\S]{0,60}?\b(?:withdrawn|withdrawal|cash\s?w\/?d|wdl)\b/i,
  },
  // Loading a wallet from your own bank. The money is still yours.
  {
    id: 'wallet-topup',
    kind: 'transfer',
    test: /\b(?:added|loaded|credited)\s+to\s+your\s+[\s\S]{0,30}?\bwallet\b|\bwallet\b[\s\S]{0,30}?\btopped\s?up\b/i,
  },
  // Paying your own card bill. The purchases on it were already expenses.
  {
    id: 'card-bill',
    kind: 'transfer',
    test: /\b(?:payment|paid)\b[\s\S]{0,50}?\b(?:towards|toward|for)\b[\s\S]{0,40}?\bcredit\s?card\b|\bcredit\s?card\b[\s\S]{0,40}?\bbill\b[\s\S]{0,30}?\b(?:paid|payment received)\b/i,
  },

  // ---- who ended up with the money --------------------------------------
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
  // "Thank you for using your HDFC Bank Card XX7781 for Rs.899.00 at NETFLIX".
  // No verb above appears in that sentence at all - the card alert says only
  // that the card was USED. Bounded to a card or account noun, so the ordinary
  // word "using" cannot turn any sentence with a number in it into a payment.
  {
    id: 'card-used',
    kind: 'debit',
    test: /\busing\s+(?:your\s+)?(?:[a-z]+\s+){0,3}(?:card|a\/c|acct|account)\b/i,
  },
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

/**
 * The bank's own reference for a payment.
 *
 * Two details here are load-bearing, because this value is now what tells one
 * payment from another - two alerts whose references DISAGREE are refused a
 * merge, so a wrong reading here silently merges two real payments into one
 * row and loses half the money.
 *
 *   1. The label may end in the word "number", not just "no". Without that
 *      alternative, "UPI Reference Number 512345678901" captured the literal
 *      word "Number" - measured, not guessed - and every alert phrased that
 *      way then carried the SAME reference as every other, which is worse than
 *      carrying none: identical references read as agreement.
 *   2. The captured value must contain a digit. That is what stops an English
 *      word from ever standing in for a reference again, whatever wording a
 *      bank invents next.
 */
const REFERENCE = /(?:upi(?:\/| )?ref(?:erence)?|ref(?:erence)?|txn(?: id)?|transaction id|imps ref)(?:\s*(?:no|number)\.?)?\s*[:.# ]?\s*(?=[A-Za-z0-9]*[0-9])([A-Za-z0-9]{4,25})\b/i;

/**
 * The other party: the payee on a debit, the payer on a credit.
 *
 * Two separate things made this harder than one regex, and the first one had
 * silently disabled the whole feature:
 *
 *   1. This had no `i` flag, so it only ever matched a LOWERCASE preposition.
 *      Half of all real alerts capitalise them - "Sent Rs.500.00 From HDFC
 *      Bank A/C x1234 To RAHUL" - and every single one of those arrived with
 *      no name at all, which is why so many rows read as a bare amount.
 *   2. Making it case-insensitive is not enough on its own. The FIRST match in
 *      that same message is "From HDFC Bank" - the user's own bank, not the
 *      person they paid. A wrong name is worse than no name: it goes into the
 *      description, it gets categorised, and it turns every payment into one
 *      merchant called "HDFC Bank".
 *
 * So every candidate is collected with the preposition that introduced it,
 * anything naming a bank or an account is dropped, and the survivor is chosen
 * by which SIDE of the payment is wanted - which depends on the direction, so
 * the choice cannot be made by a regex alone.
 */
/*
 * A name may contain spaces ("BIG BAZAAR"), so it has to be stopped
 * explicitly - and the next PREPOSITION is one of the things that stops it.
 * Without that, "from ICICI Bank Card XX1234 at AMAZON" is one candidate
 * running all the way to "AMAZON": it gets rejected for naming a bank, and
 * because a /g regex resumes after the whole match, the "at AMAZON" behind it
 * is never even looked at. The real payee vanishes because of the noise in
 * front of it.
 */
const MERCHANT_CANDIDATE =
  /\b(to|at|from|by)\s+([A-Za-z][A-Za-z0-9&.'\- ]{2,40}?)(?=\s+(?:on|via|ref|upi|a\/c|dated|txn|using|through|info|tap|view|click|swipe|open|to|at|from|by)\b|[.,]|$)/gi;

/**
 * The words a notification adds for the person reading it, not part of the
 * payment: "Tap to view", "View details", "Open the app".
 *
 * This has to be removed BEFORE the counterparty is looked for, because
 * "Tap to view" contains "to" - and the search read it as a payment to
 * somebody called "view". That is not hypothetical: a real Rs 45 received
 * from a friend was filed in this app as income from "view", with the friend's
 * name nowhere on it.
 */
const NOTIFICATION_CHROME =
  /\b(?:tap|swipe|click|press)\s+(?:to|here|for)\b[\s\S]*$|\bview\s+(?:details?|more|transaction)\b[\s\S]*$|\bopen\s+(?:the\s+)?app\b[\s\S]*$/i;

/**
 * "Karan paid you Rs.45" - the payer's name comes BEFORE the verb.
 *
 * There is no preposition anywhere in that sentence, so the search above
 * cannot see the name at all, and every payment phrased this way was filed
 * with no counterparty. It is also the single most common way a UPI app
 * announces money arriving, which made it the most-missed name in the app.
 */
const PAYER_BEFORE_VERB =
  /^\s*([A-Za-z][A-Za-z0-9&.'\- ]{1,40}?)\s+(?:paid|sent|transferred)\s+(?:it\s+)?(?:to\s+)?you\b/i;

/**
 * Never the counterparty, however well it fits the shape.
 *
 * The user's own bank is the loudest false positive - it appears in nearly
 * every message, usually before the real name - but a bare "your", an account
 * word, or a scheme name will all match a preposition just as happily.
 */
const NOT_A_COUNTERPARTY =
  /^(?:a\/c|ac|acct|account|card|your|the|this|upi|vpa|imps|neft|rtgs|ref|txn|info|bank|.*\bbank\b.*|tap|view|details?|here|now|open|more|app)$/i;

/**
 * Two more ways a candidate is obviously not a name.
 *
 * A possessive opener ("your HDFC Credit Card XX1234") is describing the
 * user's own account, not a payee - it appears wherever a message says what
 * the money was paid TOWARDS. And a bare amount is not a merchant, which is
 * worth stating because the name pattern allows digits, dots and commas, so
 * "Rs.899.00" fits the shape of a name perfectly.
 */
const POSSESSIVE_OPENER = /^(?:your|the|this|my|our)\b/i;
const LOOKS_LIKE_AN_AMOUNT = /^(?:rs\.?|inr|₹)?\s*[0-9][0-9,.]*$/i;

/**
 * Payees a preposition search cannot reach, because they are not written as
 * "<preposition> <name>" at all.
 *
 * Every one of these came out of an audit of older bank SMS on a real phone,
 * where five of eight messages produced a row with no name on it - and four of
 * those five had the payee sitting in plain sight, in a shape this table now
 * knows. Tried before the preposition scan because each is more specific.
 */
const STRUCTURED_PAYEE: Array<{ id: string; re: RegExp }> = [
  // "to swiggy@ybl", "by a/c linked to VPA rahul@okhdfc" - a UPI handle. The
  // name is the part before the @; what follows it is the payee's bank, not
  // the payee. The old pattern stopped dead at the @, which is not in the
  // character class, so the whole handle was skipped.
  {
    id: 'vpa',
    re: /\b(?:to|from|by)\s+(?:vpa\s+)?([a-z0-9][a-z0-9.\-_]{1,30})@[a-z][a-z0-9.]{1,20}\b/i,
  },
  // "Info: UPI/P2M/512345/BLINKIT" - the merchant is the last field of the
  // reference string, after the type and the sequence number.
  {
    id: 'upi-ref',
    // The `i` matters: banks write "UPI/", and without it this matched nothing
    // at all - the same missing flag that disabled the whole payee search once
    // already, caught here only because the test named the expected answer.
    re: /\bupi\/(?:[A-Za-z0-9]+\/){1,3}([A-Za-z][A-Za-z0-9 &.'-]{1,30}?)(?=[\s.,;]|$)/i,
  },
  // "...debited for Rs 1,250.00 on 05-Sep-26; ZOMATO credited." - ICICI names
  // the receiving side after a semicolon. On a debit, whoever was credited is
  // exactly who was paid.
  {
    id: 'semicolon-credited',
    re: /;\s*([A-Za-z][A-Za-z0-9 &.'-]{1,30}?)\s+credited\b/i,
  },
  // "towards VPS*BIGBAZAAR" - "towards" is how the older SBI template names
  // the shop, and the card network stamps its own prefix in front of it.
  {
    id: 'towards',
    re: /\btowards?\s+(?:[A-Za-z]{2,4}\*)?([A-Za-z][A-Za-z0-9 &.'-]{1,30}?)(?=\s+(?:on|via|ref|dated|txn)\b|[.,;]|$)/i,
  },
];

/**
 * Which preposition names the party we want, best first.
 *
 * On a payment "to"/"at" introduce the payee and "from" introduces the user's
 * own account; on money arriving it is the other way round. Getting this
 * backwards is how the sender of your salary becomes your own bank.
 */
const COUNTERPARTY_SIDE: Record<SmsKind, string[]> = {
  debit: ['to', 'at', 'from', 'by'],
  transfer: ['to', 'at', 'from', 'by'],
  credit: ['from', 'by', 'to', 'at'],
};

/** The best counterparty the message offers, or undefined if none is safe. */
/** A trimmed candidate, or undefined when it is not a name at all. */
function usable(raw: string): string | undefined {
  const name = raw.trim();
  if (!name) return undefined;
  if (NOT_A_COUNTERPARTY.test(name)) return undefined;
  if (POSSESSIVE_OPENER.test(name)) return undefined;
  if (LOOKS_LIKE_AN_AMOUNT.test(name)) return undefined;
  return name;
}

function findMerchant(body: string, kind: SmsKind): string | undefined {
  // "Tap to view" is not a payee. Removed first, so it cannot be mined for a
  // name and cannot run onto the end of a real one ("Karan Tap").
  const text = body.replace(NOTIFICATION_CHROME, ' ');

  // A name sitting before the verb is invisible to the preposition search, so
  // it is tried first - and only for money arriving, which is the only
  // direction this phrasing occurs in.
  if (kind === 'credit') {
    const payer = PAYER_BEFORE_VERB.exec(text);
    if (payer) {
      const name = usable(payer[1]);
      if (name) return name;
    }
  }

  // Then the shapes that are not "<preposition> <name>" at all.
  for (const rule of STRUCTURED_PAYEE) {
    const match = rule.re.exec(text);
    if (!match) continue;
    const name = usable(match[1]);
    if (name) return name;
  }

  const order = COUNTERPARTY_SIDE[kind];
  let best: { rank: number; name: string } | undefined;

  MERCHANT_CANDIDATE.lastIndex = 0;   // a /g regex carries state between calls
  for (let m = MERCHANT_CANDIDATE.exec(text); m; m = MERCHANT_CANDIDATE.exec(text)) {
    const name = usable(m[2]);
    if (!name) continue;

    const rank = order.indexOf(m[1].toLowerCase());
    if (rank < 0) continue;
    // Strictly better only, so among equally good prepositions the FIRST is
    // kept - "to SWIGGY on 05-Sep to settle" should not drift to "settle".
    if (!best || rank < best.rank) best = { rank, name };
  }

  return best?.name;
}

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

  const merchant = findMerchant(body, direction.kind);
  if (merchant) parsed.merchant = merchant;

  return parsed;
}
