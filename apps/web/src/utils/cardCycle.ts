/**
 * A credit card's billing cycle, and what is owed on it.
 *
 * A card is the one account where the balance is not the question. What
 * matters is which cycle a purchase landed in, what closed on the statement,
 * and how long is left to pay it - and none of that is visible in a list of
 * transactions. People miss due dates on cards they have the money to pay,
 * which is the most expensive avoidable mistake in personal finance: interest
 * on an Indian card runs 36-46% a year, backdated to the purchase date, and a
 * late fee on top.
 *
 * All of it is calendar arithmetic, which is where the bugs live:
 *
 *   - a statement day of the 31st does not exist in February, or in any of
 *     the four 30-day months;
 *   - a cycle spans a month boundary, so "this month's spending" is the wrong
 *     question entirely;
 *   - the due date is in the SAME month as the statement when the due day
 *     falls after it, and the NEXT month when it does not.
 *
 * Every date is computed in the reader's own timezone, because a card closes
 * on "the 18th" in their calendar rather than in Greenwich's - see `dateOn`.
 * Every "now" is passed in rather than read from the clock, so the same ledger
 * always produces the same answer and none of this depends on when it is
 * asked.
 */

const DAY = 86_400_000;

export interface CardTerms {
  /** Day of the month the statement closes, 1-31. */
  statementDay: number;
  /** Day of the month payment is due, 1-31. */
  dueDay: number;
  /** The card's limit, when the user has told us. */
  creditLimitMinor?: number | null;
}

export interface CardCycle {
  /** The statement that most recently closed. */
  lastStatementAt: number;
  /** When the next one closes - the cycle now accruing ends here. */
  nextStatementAt: number;
  /** Purchases after this instant belong to the cycle now accruing. */
  currentCycleFrom: number;
  /** When the last closed statement must be paid. */
  dueAt: number;
  /** Whole days from today to the due date; negative once the day has passed. */
  daysUntilDue: number;
  /** Whole days until the cycle now accruing closes. */
  daysUntilStatement: number;
  /** The due DAY has ended without the statement being cleared. */
  isOverdue: boolean;
}

/**
 * A day-of-month that exists in the given month.
 *
 * The 31st is not a date in February, and a card whose statement closes on the
 * 31st still closes in February - on the 28th, or the 29th. Rolling over into
 * March instead, which is what Date does if you let it, moves a whole cycle
 * and every purchase in it.
 */
export function clampDayToMonth(year: number, month: number, day: number): number {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return Math.min(day, lastDay);
}

/**
 * Midnight on the given day-of-month, in the reader's own timezone.
 *
 * Local rather than UTC, and that is the whole point. A card closes on "the
 * 18th" in the calendar hanging on the user's wall, not in Greenwich's. In
 * India - UTC+5:30 - the two disagree for the five and a half hours after
 * local midnight, and computing in UTC put the app a day behind for that
 * whole window: at 2am on the due date it showed the date as today and the
 * countdown as "due in 1 day", disagreeing with itself on the one screen
 * whose only job is to say when to pay.
 */
const dateOn = (year: number, month: number, day: number): number =>
  new Date(year, month, clampDayToMonth(year, month, day)).getTime();

/**
 * Where the card is in its cycle right now.
 *
 * `now` is an argument rather than a reading of the clock, so this is testable
 * and so every row on a screen is measured from the same instant.
 */
export function cardCycle(terms: CardTerms, now: number): CardCycle {
  const today = new Date(now);
  const year = today.getFullYear();
  const month = today.getMonth();

  const thisMonthStatement = dateOn(year, month, terms.statementDay);

  // The statement that has closed most recently. If this month's has not
  // arrived yet, the last one was in the previous month.
  const lastStatementAt = now >= thisMonthStatement
    ? thisMonthStatement
    : dateOn(year, month - 1, terms.statementDay);

  const lastDate = new Date(lastStatementAt);
  const nextStatementAt = dateOn(
    lastDate.getFullYear(), lastDate.getMonth() + 1, terms.statementDay,
  );

  /* The due date belongs to the statement that just closed, and which month it
     falls in depends on the two days: a card that closes on the 5th and is due
     on the 25th is due in the SAME month, while one that closes on the 18th
     and is due on the 8th is due in the next. Assuming "always next month"
     puts the reminder four weeks late for the first kind. */
  const dueMonthOffset = terms.dueDay > terms.statementDay ? 0 : 1;
  const dueAt = dateOn(
    lastDate.getFullYear(), lastDate.getMonth() + dueMonthOffset, terms.dueDay,
  );

  /* Counted from the START of today, not from this instant.
     A due date is a day, not a moment: a payment due on the 8th is not late at
     ten in the morning on the 8th. Measuring from `now` made a card overdue
     from one second past midnight on its own due date, and - because the
     remainder then rounded the wrong way - showed a card a full day late as
     still "due today". Both disappear once the unit is the day. */
  const todayStart = new Date(year, month, today.getDate()).getTime();

  const daysUntilDue = Math.round((dueAt - todayStart) / DAY);

  return {
    lastStatementAt,
    nextStatementAt,
    currentCycleFrom: lastStatementAt,
    dueAt,
    daysUntilDue,
    daysUntilStatement: Math.round((nextStatementAt - todayStart) / DAY),
    // Late only once the due day itself has ended.
    isOverdue: daysUntilDue < 0,
  };
}

export interface CycleTransaction {
  amount_minor: number;
  transaction_type: 'income' | 'expense' | 'transfer';
  transaction_date: string;
}

/** A ledger row, as much of one as this module needs to read. */
export interface LedgerRow {
  amount_minor: number;
  transaction_type: 'income' | 'expense' | 'transfer';
  transaction_date: string;
  account_id?: string | null;
  to_account_id?: string | null;
}

/**
 * The rows that belong to one card, with each one's direction resolved.
 *
 * A transfer is the only ambiguous kind: on a card, money arriving is a
 * repayment and money leaving is a purchase, and the two are the same
 * transaction_type distinguished only by which end the card is. Reading the
 * type alone would count a payment made FROM the card as a payment made TO it,
 * and quietly cancel out real spending.
 */
export function cardLedger(
  rows: readonly LedgerRow[],
  accountId: string,
): CycleTransaction[] {
  const mine = rows.filter(
    (r) => r.account_id === accountId || r.to_account_id === accountId,
  );
  return mine.map((r) => ({
    amount_minor: r.amount_minor,
    transaction_type:
      r.transaction_type === 'transfer' && r.to_account_id !== accountId
        ? 'expense'
        : r.transaction_type,
    transaction_date: r.transaction_date,
  }));
}

export interface CycleTotals {
  /** Spent since the last statement closed - not yet billed. */
  currentCycleMinor: number;
  /** Spent in the cycle the last statement covers - what is owed. */
  lastStatementMinor: number;
  /** Paid towards the card since that statement closed. */
  paidSinceStatementMinor: number;
  /** Still owed on the last statement, never below zero. */
  outstandingMinor: number;
}

/**
 * What each cycle holds.
 *
 * A payment TO the card arrives as a transfer into it, or as income on the
 * account, depending on how it was recorded - both mean the same thing here,
 * so both count against what is owed. Counting only one of them would tell
 * somebody who has already paid that they still owe it.
 */
export function cycleTotals(
  transactions: readonly CycleTransaction[],
  cycle: CardCycle,
  terms: CardTerms,
): CycleTotals {
  const previousStatementAt = (() => {
    const d = new Date(cycle.lastStatementAt);
    return dateOn(d.getFullYear(), d.getMonth() - 1, terms.statementDay);
  })();

  let currentCycleMinor = 0;
  let lastStatementMinor = 0;
  let paidSinceStatementMinor = 0;

  for (const t of transactions) {
    const at = Date.parse(t.transaction_date);
    if (!Number.isFinite(at)) continue;

    if (t.transaction_type === 'expense') {
      if (at > cycle.lastStatementAt) currentCycleMinor += t.amount_minor;
      else if (at > previousStatementAt) lastStatementMinor += t.amount_minor;
    } else if (at > cycle.lastStatementAt) {
      // Money arriving on a card is a repayment, however it was filed.
      paidSinceStatementMinor += t.amount_minor;
    }
  }

  return {
    currentCycleMinor,
    lastStatementMinor,
    paidSinceStatementMinor,
    // Never negative: overpaying leaves a credit on the card, not a debt owed
    // back to the user, and a negative "still owed" reads as an error.
    outstandingMinor: Math.max(0, lastStatementMinor - paidSinceStatementMinor),
  };
}

/**
 * How much of the limit is in use, or null when no limit is known.
 *
 * Both cycles count: the card issuer does not wait for a statement before
 * reducing what is available to spend.
 */
export function limitUsedPercent(
  totals: CycleTotals,
  terms: CardTerms,
): number | null {
  const limit = terms.creditLimitMinor;
  if (!limit || limit <= 0) return null;
  const used = totals.outstandingMinor + totals.currentCycleMinor;
  return Math.round((used / limit) * 100);
}

/* ---------------------------------------------------------------------------
   EMI

   A purchase converted to instalments is not one expense. It is a commitment
   for a year or two that shows up nowhere in a month's spending until the
   month it lands in - which is exactly how people end up with more instalments
   running than they meant to.
   --------------------------------------------------------------------------- */

export interface EmiPlan {
  /** What is being paid off, as the user would name it. */
  name: string;
  /** The instalment, per month. */
  monthlyMinor: number;
  /** How many instalments in total. */
  months: number;
  /** ISO date of the first instalment. */
  startedAt: string;
}

export interface EmiProgress {
  paidCount: number;
  remainingCount: number;
  paidMinor: number;
  remainingMinor: number;
  /** When the last instalment falls. */
  finishesAt: number;
  /** Whole months until it is finished; 0 when it already is. */
  monthsLeft: number;
  isFinished: boolean;
}

/**
 * How far through an instalment plan the user is.
 *
 * Counted by elapsed months rather than by matching payments in the ledger:
 * an EMI is charged by the bank whether or not the app saw the alert, and a
 * plan that under-reports because one month's notification was missed would
 * be worse than useless - it would tell somebody they owe less than they do.
 */
export function emiProgress(plan: EmiPlan, now: number): EmiProgress {
  const start = new Date(Date.parse(plan.startedAt));
  const startYear = start.getFullYear();
  const startMonth = start.getMonth();
  const startDay = start.getDate();

  const today = new Date(now);
  let elapsed = (today.getFullYear() - startYear) * 12
    + (today.getMonth() - startMonth);
  // The instalment for the current month has not been taken until its day.
  if (today.getDate() < clampDayToMonth(today.getFullYear(), today.getMonth(), startDay)) {
    elapsed -= 1;
  }

  const paidCount = Math.max(0, Math.min(plan.months, elapsed + 1));
  const remainingCount = Math.max(0, plan.months - paidCount);

  const finishesAt = dateOn(startYear, startMonth + plan.months - 1, startDay);

  return {
    paidCount,
    remainingCount,
    paidMinor: paidCount * plan.monthlyMinor,
    remainingMinor: remainingCount * plan.monthlyMinor,
    finishesAt,
    monthsLeft: remainingCount,
    isFinished: remainingCount === 0,
  };
}

/** Every instalment still to come, across all plans, per month. */
export function monthlyEmiLoad(plans: readonly EmiPlan[], now: number): number {
  return plans
    .filter((plan) => !emiProgress(plan, now).isFinished)
    .reduce((sum, plan) => sum + plan.monthlyMinor, 0);
}
