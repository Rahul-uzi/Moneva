import { isPaymentApp } from './paymentAlert';

/**
 * Money that leaves on a rhythm.
 *
 * Nobody forgets rent. What people lose money to is the small stuff they
 * agreed to once - a trial that turned into a subscription, a service they
 * stopped using, a price that went up 30% without an email anyone read. The
 * app already holds the evidence; it has just never been asked the question.
 *
 * The whole difficulty is in REFUSING. A list of subscriptions is only useful
 * if the user believes it, and one wrong row - takeaway they order most weeks
 * listed as a "subscription" - makes the whole list something to scroll past.
 * So this is deliberately strict, and everything below is a reason to say no:
 *
 *   - three payments minimum, because two of anything is a coincidence;
 *   - every gap has to fit one cadence, so twenty Swiggy orders in a month
 *     are rejected however regular they look on average;
 *   - the amounts have to agree, because a bill that swings 3x is a shop, not
 *     a subscription.
 *
 * Missing a real subscription costs nothing - the payment is in the ledger
 * either way. Inventing one costs the user's trust in the entire feature.
 */

export interface SubscriptionPayment {
  amountMinor: number;
  /** Epoch ms. */
  at: number;
}

export interface Subscription {
  /** The payee as written, in the spelling the user will recognise. */
  name: string;
  cadence: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  /** The typical charge - the median, so one odd month cannot skew it. */
  amountMinor: number;
  payments: SubscriptionPayment[];
  firstSeen: number;
  lastSeen: number;
  /** When the next one is due, projected from the last at this cadence. */
  nextExpected: number;
  /** What it costs over a year at this cadence and this amount. */
  yearlyMinor: number;
  /** Set only when the latest charge is meaningfully above what came before. */
  priceRise?: { fromMinor: number; toMinor: number; percent: number };
}

/** The minimum a transaction needs to take part. */
export interface SubscriptionInput {
  description?: string | null;
  amount_minor: number;
  transaction_type: 'income' | 'expense' | 'transfer';
  transaction_date: string;
}

const DAY = 86_400_000;

/**
 * The rhythms worth naming, and how far each is allowed to drift.
 *
 * Billing dates wander: a monthly charge on the 31st lands on the 28th in
 * February, and a card retry can push one a few days late. The tolerances are
 * what a real statement looks like, not what a calendar would predict.
 */
const CADENCES = [
  { name: 'weekly' as const, days: 7, slack: 2, perYear: 52 },
  { name: 'monthly' as const, days: 30, slack: 6, perYear: 12 },
  { name: 'quarterly' as const, days: 91, slack: 12, perYear: 4 },
  { name: 'yearly' as const, days: 365, slack: 20, perYear: 1 },
];

/** At least three payments, because two of anything is a coincidence. */
const MIN_PAYMENTS = 3;

/** How far an individual charge may sit from the typical one. */
const AMOUNT_TOLERANCE = 0.2;

/** A rise worth mentioning, rather than a rounding or a tax change. */
const PRICE_RISE_THRESHOLD = 0.05;

/**
 * How stale a subscription may be and still be worth listing.
 *
 * Something cancelled eighteen months ago is history, not a decision waiting
 * to be made, and a list that never forgets anything stops being a list of
 * things to act on. Long enough to still catch a yearly renewal that has been
 * missed once - which is exactly the case worth surfacing.
 */
const FORGET_AFTER_DAYS = 550;

/**
 * Words a bank puts in every narration, which say nothing about who was paid.
 *
 * Left in, they are harmless for grouping - they appear on every one of that
 * merchant's payments. They are stripped so an IMPORTED row can meet a
 * CAPTURED one: the statement says "UPI-SWIGGY-9812" and the notification
 * says "Swiggy", and those have to reach the same key or the same
 * subscription is two half-groups, neither of them big enough to count.
 */
const SCHEME_NOISE = new Set([
  'upi', 'neft', 'imps', 'rtgs', 'ach', 'pos', 'atm', 'ecs', 'nach',
  'dr', 'cr', 'by', 'to', 'from', 'transfer', 'tfr', 'ref', 'txn', 'trf',
  'payment', 'purchase', 'debit', 'credit', 'card', 'vps', 'inf',
]);

/** A transaction reference: a long run of digits, unique to one payment. */
const isReference = (token: string) => /^\d{4,}$/.test(token);

/**
 * The description with the rail prefix removed, if there was one.
 * Shared by the key and the display name so the two never disagree.
 */
function withoutRail(description: string): string {
  const text = description.trim();
  const dash = text.indexOf(' - ');
  if (dash > 0 && isPaymentApp(text.slice(0, dash).trim())) {
    return text.slice(dash + 3);
  }
  return text;
}

/**
 * What to call this subscription on screen.
 *
 * The raw narration is not usable as a name. A statement writes
 * "UPI-NETFLIX-4078", and showing that has two faults: nobody recognises it
 * as Netflix, and the number belongs to whichever single payment happened to
 * be seen first - so the label for a four-month subscription is one arbitrary
 * transaction's reference.
 *
 * Same filter as the key, but the original spelling is kept: the user should
 * see the shop's name as their bank writes it, not a lowercased slug.
 */
export function subscriptionName(description: string): string {
  const tokens = withoutRail(description)
    .replace(/^from\s+/i, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

  const meaningful = tokens.filter(
    (t) => !isReference(t) && !SCHEME_NOISE.has(t.toLowerCase()),
  );

  const kept = meaningful.length > 0 ? meaningful : tokens;
  return kept.length > 0 ? kept.join(' ') : description.trim();
}

/**
 * What two payments have to share to be the same subscription.
 *
 * Capture writes the rail into the description for a person ("PhonePe -
 * RAHUL") but leaves a brand to name itself ("Netflix"), and a statement
 * writes neither - it writes "UPI-NETFLIX-4078". Stripping the rail, the
 * scheme words and the reference is what lets all three reach one key.
 */
export function subscriptionKey(description: string): string {
  let text = description.trim();

  // Strip the rail ONLY when the prefix really is one. Stripping any
  // "<something> - " ate the merchant instead: "Third Wave Coffee - Mumbai"
  // came out as "mumbai", so two unrelated shops in the same city grouped
  // together and were offered as one subscription to cancel. A description is
  // just as often "Payee - Branch" as "Rail - Payee", and only the rail list
  // can tell them apart.
  const dash = text.indexOf(' - ');
  if (dash > 0 && isPaymentApp(text.slice(0, dash).trim())) {
    text = text.slice(dash + 3);
  }

  const tokens = text
    .replace(/^from\s+/i, '')            // "From PhonePe"  -> "PhonePe"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  /* The reference is what made this whole feature blind to imported history.
     A bank stamps a different number on every line - "UPI-NETFLIX-9812", then
     "UPI-NETFLIX-4471" - so a year of a monthly subscription arrived as twelve
     groups of one, and nothing was ever detected in a statement. Which is the
     worst place for it to fail: import exists to bring that history in. */
  const meaningful = tokens.filter((t) => !isReference(t) && !SCHEME_NOISE.has(t));

  // If a merchant is named entirely in words this strips, keep the original
  // rather than collapsing every such row into one empty key.
  return (meaningful.length > 0 ? meaningful : tokens).join(' ');
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/** Whether one run of charges is stable enough to be a single price. */
const steady = (amounts: readonly number[]): boolean => {
  if (amounts.length === 0) return false;
  const typical = median(amounts);
  if (typical <= 0) return false;
  return amounts.every((a) => Math.abs(a - typical) / typical <= AMOUNT_TOLERANCE);
};

/**
 * The charges a subscription is currently being made at.
 *
 * A subscription is not one price - it is one price, then sometimes another.
 * Requiring every charge to sit near a single median seemed obvious and was
 * wrong in a way that cancelled a whole feature: a rise from Rs 299 to Rs 399
 * is 33% off the median, so the series was rejected as "inconsistent" and the
 * subscription vanished. The price-rise flag could therefore only ever fire
 * for rises smaller than the tolerance that hid them - and the unit test
 * happened to use a 15% rise, so it passed.
 *
 * So: steady throughout, or steady either side of ONE step. Two steps is not
 * a subscription changing price, it is a shop.
 *
 * Returns the run of charges at the CURRENT price, which is what the yearly
 * figure should be based on - what it costs now, not what it averaged.
 */
function currentPriceRun(chronological: readonly number[]): readonly number[] | null {
  if (steady(chronological)) return chronological;

  // The split has to be AT the price change, which is the largest jump
  // between consecutive charges - not merely the first split that happens to
  // work. Scanning for the first one put the boundary in the wrong place:
  // [299, 299 | 299, 399] passed, because 299 and 399 are both within 20% of
  // their own median of 349, and the "current price" came out as 349 - a
  // number that was never charged.
  let boundary = -1;
  let biggest = 0;
  for (let i = 1; i < chronological.length; i += 1) {
    const previous = chronological[i - 1];
    if (previous <= 0) continue;
    const jump = Math.abs(chronological[i] - previous) / previous;
    if (jump > biggest) {
      biggest = jump;
      boundary = i;
    }
  }

  // At least two charges at the old price, so there was a price to change
  // FROM; at least one at the new, or nothing changed.
  if (boundary < 2) return null;

  const before = chronological.slice(0, boundary);
  const after = chronological.slice(boundary);
  return steady(before) && steady(after) ? after : null;
}

/**
 * The cadence every gap agrees on, or null.
 *
 * Deliberately unanimous rather than averaged. An average would happily call
 * twenty takeaway orders "monthly" because the mean gap works out near 30 -
 * which is exactly the wrong row to put in this list.
 *
 * One allowance: a gap of about twice the cadence is a skipped cycle, which
 * happens when a card is declined and retried the following month. Any other
 * gap disqualifies the whole group.
 */
function cadenceOf(gaps: number[]): (typeof CADENCES)[number] | null {
  for (const cadence of CADENCES) {
    const fits = gaps.every((gap) => {
      const days = gap / DAY;
      const single = Math.abs(days - cadence.days) <= cadence.slack;
      const skipped = Math.abs(days - cadence.days * 2) <= cadence.slack * 2;
      return single || skipped;
    });
    if (fits) return cadence;
  }
  return null;
}

/**
 * Everything that looks like it repeats, largest yearly cost first.
 *
 * `now` is passed in rather than read, so this is testable and so the same
 * ledger always produces the same answer.
 */
export function findSubscriptions(
  transactions: readonly SubscriptionInput[],
  now: number,
): Subscription[] {
  const groups = new Map<string, { name: string; payments: SubscriptionPayment[] }>();

  for (const t of transactions) {
    // Only money actually spent. A transfer is the user's own money moving,
    // and income has no business in a list of things to cancel.
    if (t.transaction_type !== 'expense') continue;
    const description = (t.description ?? '').trim();
    if (!description) continue;

    const key = subscriptionKey(description);
    if (!key) continue;

    const at = Date.parse(t.transaction_date);
    if (!Number.isFinite(at)) continue;

    // The cleaned name, not the raw narration: a statement writes
    // "UPI-NETFLIX-4078", and that reference belongs to one arbitrary payment.
    const group = groups.get(key) ?? { name: subscriptionName(description), payments: [] };
    group.payments.push({ amountMinor: t.amount_minor, at });
    groups.set(key, group);
  }

  const found: Subscription[] = [];

  for (const group of groups.values()) {
    const payments = [...group.payments].sort((a, b) => a.at - b.at);
    if (payments.length < MIN_PAYMENTS) continue;

    const gaps = payments.slice(1).map((p, i) => p.at - payments[i].at);
    const cadence = cadenceOf(gaps);
    if (!cadence) continue;

    // A charge that swings wildly is a shop, not a subscription - but one
    // that stepped up once is a subscription whose price went up.
    const chronological = payments.map((p) => p.amountMinor);
    const currentRun = currentPriceRun(chronological);
    if (!currentRun) continue;

    // What it costs NOW, which is what a yearly figure should be built from.
    const typical = median(currentRun);
    if (typical <= 0) continue;

    const last = payments[payments.length - 1];
    // Long dead. Still a real pattern, but not one anyone can act on.
    if (now - last.at > FORGET_AFTER_DAYS * DAY) continue;

    const earlier = chronological.slice(0, chronological.length - currentRun.length);
    const earlierTypical = earlier.length > 0
      ? median(earlier)
      : median(chronological.slice(0, -1));

    const subscription: Subscription = {
      name: group.name,
      cadence: cadence.name,
      amountMinor: typical,
      payments,
      firstSeen: payments[0].at,
      lastSeen: last.at,
      nextExpected: last.at + cadence.days * DAY,
      yearlyMinor: typical * cadence.perYear,
    };

    if (earlierTypical > 0 && last.amountMinor > earlierTypical * (1 + PRICE_RISE_THRESHOLD)) {
      subscription.priceRise = {
        fromMinor: earlierTypical,
        toMinor: last.amountMinor,
        percent: Math.round(((last.amountMinor - earlierTypical) / earlierTypical) * 100),
      };
    }

    found.push(subscription);
  }

  // Dearest per year first: that is the order in which they are worth a
  // decision, which is not the order they happen to have been paid in.
  return found.sort((a, b) => b.yearlyMinor - a.yearlyMinor);
}

/**
 * One that has gone quiet - paid on a rhythm, then stopped.
 *
 * Worth surfacing separately because it means one of two things, and the user
 * knows which: they cancelled it, or a payment failed and the service is
 * about to lapse. Both are worth a glance; neither is worth an alarm.
 */
export function isLapsed(subscription: Subscription, now: number): boolean {
  const cadence = CADENCES.find((c) => c.name === subscription.cadence);
  if (!cadence) return false;
  return now - subscription.lastSeen > (cadence.days + cadence.slack * 2) * DAY;
}
