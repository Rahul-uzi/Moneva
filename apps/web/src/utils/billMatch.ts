/**
 * Is this payment the bill, or just a payment?
 *
 * WHY THIS EXISTS. "Pay Now" assumes the user chooses when to pay. An autopay
 * mandate does not work that way: the money leaves on the 3rd whether anybody
 * opens the app or not, and the only thing that ever reaches MONEVA is the
 * bank's SMS. Without this, that SMS became an ordinary expense, the bill sat
 * on "upcoming" until it went overdue, and the user had to settle by hand a
 * payment that had already happened - which also records the SAME rupees
 * twice, once as the alert and once as the bill.
 *
 * So a detected payment is offered against the bills that are waiting, and
 * confirming it settles the bill rather than filing a second expense.
 *
 * DELIBERATELY STRICT. A wrong match is worse than no match: it marks a bill
 * paid that was not, rolls its due date a month forward, and the user stops
 * being reminded about money that is still owed. Every rule below exists to
 * make a false positive hard, and an ambiguous case returns nothing rather
 * than guessing.
 */

export interface BillLike {
  id: string;
  name: string;
  amount_minor: number;
  due_date: string;
  status?: string | null;
  recurrence?: string | null;
}

export interface PaymentLike {
  /** Paise. Compared exactly - a mandate takes the agreed figure. */
  amountPaise: number;
  /** Only money going OUT can settle a bill. */
  kind: 'debit' | 'credit' | 'transfer' | string;
  /** Epoch ms the alert was posted. */
  postedAt: number;
  /** Whatever the alert named, when it named anything. */
  merchant?: string;
}

export interface BillMatch {
  bill: BillLike;
  /** Why, in words, for the card. The user approves the match, not the rule. */
  reason: string;
  /** True when the bill's name was actually found in the alert. */
  nameMatched: boolean;
}

/** A bill still owed. "paid" and "cancelled" are finished. */
const isOpen = (b: BillLike): boolean =>
  !['paid', 'cancelled'].includes((b.status ?? 'upcoming').trim().toLowerCase());

const DAY = 24 * 60 * 60 * 1000;

/**
 * How far from the due date a payment can land and still be that bill.
 *
 * Asymmetric on purpose. A mandate is presented ON the due date and can retry
 * for days after a failure, so late is ordinary; early is not, and a wide
 * early window would let next month's identical payment settle this month's
 * bill while it is still owed.
 */
export const EARLY_DAYS = 3;
export const LATE_DAYS = 10;

/** Letters and digits only, so "Spotify India" and "SPOTIFY*IN" compare alike. */
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Does the alert name this bill?
 *
 * Containment either way, and only for names long enough to mean something -
 * a two letter bill name would match almost any narration, which is exactly
 * the false positive this file exists to avoid.
 */
const namesAgree = (billName: string, merchant?: string): boolean => {
  if (!merchant) return false;
  const a = squash(billName);
  const b = squash(merchant);
  if (a.length < 4 || b.length < 3) return false;
  return b.includes(a) || a.includes(b);
};

const daysBetween = (aMs: number, bMs: number): number => (aMs - bMs) / DAY;

/**
 * The bill this payment settles, or null.
 *
 * `now` is unused by the rules - the comparison is payment against due date,
 * not against today - and is left out deliberately so the result cannot change
 * between the card being drawn and the user tapping it.
 */
export const matchBillForPayment = (
  payment: PaymentLike,
  bills: readonly BillLike[],
): BillMatch | null => {
  if (payment.kind !== 'debit') return null;
  if (!Number.isFinite(payment.amountPaise) || payment.amountPaise <= 0) return null;

  const candidates = bills.filter((b) => {
    if (!isOpen(b)) return false;
    // Exact. A mandate takes the figure it was signed for, and "close enough"
    // on money is how the wrong bill gets settled.
    if (b.amount_minor !== payment.amountPaise) return false;
    const due = Date.parse(b.due_date);
    if (Number.isNaN(due)) return false;
    const drift = daysBetween(payment.postedAt, due);
    return drift >= -EARLY_DAYS && drift <= LATE_DAYS;
  });

  if (candidates.length === 0) return null;

  const named = candidates.filter((b) => namesAgree(b.name, payment.merchant));

  // Two bills for the same amount in the same window. The name is the only
  // thing that can separate them, and without exactly one naming hit there is
  // no honest answer - so say nothing and let the payment be an expense.
  if (candidates.length > 1) {
    if (named.length !== 1) return null;
    return {
      bill: named[0],
      reason: `${named[0].name} is due for this exact amount, and the alert names it`,
      nameMatched: true,
    };
  }

  const bill = candidates[0];
  const nameMatched = named.length === 1;
  return {
    bill,
    reason: nameMatched
      ? `${bill.name} is due for this exact amount, and the alert names it`
      : `${bill.name} is due for this exact amount around now`,
    nameMatched,
  };
};
