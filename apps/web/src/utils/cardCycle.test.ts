import { describe, it, expect } from 'vitest';
import {
  cardCycle, cycleTotals, limitUsedPercent, clampDayToMonth,
  emiProgress, monthlyEmiLoad, cardLedger,
  type CardTerms, type CycleTransaction, type EmiPlan,
} from './cardCycle';

/**
 * Calendar arithmetic, which is where every bug in this feature lives.
 *
 * A card is the one account where the balance is not the question - what
 * matters is which cycle a purchase landed in and how long is left to pay it.
 * Getting the dates wrong moves a whole cycle and every purchase in it, and
 * the cost of being wrong is not cosmetic: interest on an Indian card runs
 * 36-46% a year, backdated to the purchase date.
 */

const at = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

/** Statement closes on the 18th, payment due on the 8th of the next month. */
const HDFC: CardTerms = { statementDay: 18, dueDay: 8, creditLimitMinor: 20_000_00 };

describe('the day a month does not have', () => {
  it('keeps the 31st inside February', () => {
    // 2026 is not a leap year.
    expect(clampDayToMonth(2026, 1, 31)).toBe(28);
    expect(clampDayToMonth(2024, 1, 31)).toBe(29);
  });

  it('keeps the 31st inside a 30-day month', () => {
    expect(clampDayToMonth(2026, 3, 31)).toBe(30);   // April
  });

  it('leaves a day that exists alone', () => {
    expect(clampDayToMonth(2026, 0, 15)).toBe(15);
  });

  it('does not let a statement roll into the following month', () => {
    // The classic failure: asking for 31 February and being handed 3 March,
    // which moves the cycle and every purchase in it.
    const cycle = cardCycle({ statementDay: 31, dueDay: 20 }, at(2026, 2, 20));
    expect(new Date(cycle.lastStatementAt).toISOString().slice(0, 10)).toBe('2026-01-31');
    expect(new Date(cycle.nextStatementAt).toISOString().slice(0, 10)).toBe('2026-02-28');
  });
});

describe('where the card is in its cycle', () => {
  it('after the statement day, the last statement is this month', () => {
    const cycle = cardCycle(HDFC, at(2026, 9, 20));
    expect(new Date(cycle.lastStatementAt).toISOString().slice(0, 10)).toBe('2026-09-18');
    expect(new Date(cycle.nextStatementAt).toISOString().slice(0, 10)).toBe('2026-10-18');
  });

  it('before the statement day, the last statement was last month', () => {
    const cycle = cardCycle(HDFC, at(2026, 9, 10));
    expect(new Date(cycle.lastStatementAt).toISOString().slice(0, 10)).toBe('2026-08-18');
    expect(new Date(cycle.nextStatementAt).toISOString().slice(0, 10)).toBe('2026-09-18');
  });

  it('crosses a year boundary', () => {
    const cycle = cardCycle(HDFC, at(2027, 1, 5));
    expect(new Date(cycle.lastStatementAt).toISOString().slice(0, 10)).toBe('2026-12-18');
    expect(new Date(cycle.nextStatementAt).toISOString().slice(0, 10)).toBe('2027-01-18');
  });
});

/**
 * Which month the payment falls in is not a constant.
 *
 * A card closing on the 18th and due on the 8th is due NEXT month. A card
 * closing on the 5th and due on the 25th is due in the SAME one. Assuming
 * "always next month" puts the reminder four weeks late for the second kind,
 * which is the whole thing this feature exists to prevent.
 */
describe('when the payment is actually due', () => {
  it('is next month when the due day comes before the statement day', () => {
    const cycle = cardCycle(HDFC, at(2026, 9, 20));
    expect(new Date(cycle.dueAt).toISOString().slice(0, 10)).toBe('2026-10-08');
  });

  it('is the same month when the due day comes after it', () => {
    const card: CardTerms = { statementDay: 5, dueDay: 25 };
    const cycle = cardCycle(card, at(2026, 9, 10));
    expect(new Date(cycle.dueAt).toISOString().slice(0, 10)).toBe('2026-09-25');
  });

  it('counts the days left, and says when they have run out', () => {
    const cycle = cardCycle(HDFC, at(2026, 10, 3));
    expect(cycle.daysUntilDue).toBe(5);
    expect(cycle.isOverdue).toBe(false);

    const late = cardCycle(HDFC, at(2026, 10, 12));
    expect(late.daysUntilDue).toBeLessThan(0);
    expect(late.isOverdue).toBe(true);
  });
});

describe('what each cycle holds', () => {
  const spend = (day: number, month: number, rupees: number): CycleTransaction => ({
    amount_minor: rupees * 100, transaction_type: 'expense',
    transaction_date: new Date(at(2026, month, day)).toISOString(),
  });

  it('separates what is billed from what is still accruing', () => {
    const now = at(2026, 9, 25);           // statement closed on the 18th
    const cycle = cardCycle(HDFC, now);
    const totals = cycleTotals([
      spend(10, 8, 500),      // before the Aug statement - an older cycle, not counted
      spend(25, 8, 1200),     // the cycle the last statement covers
      spend(10, 9, 800),      // ditto
      spend(20, 9, 300),      // after the statement - still accruing
      spend(24, 9, 450),      // ditto
    ], cycle, HDFC);

    expect(totals.lastStatementMinor).toBe(200000);   // 1200 + 800
    expect(totals.currentCycleMinor).toBe(75000);     // 300 + 450
  });

  it('counts a repayment however it was recorded', () => {
    // A payment to a card arrives as a transfer into it, or as income on the
    // account, depending on how it was entered. Counting only one would tell
    // somebody who has already paid that they still owe it.
    const now = at(2026, 9, 25);
    const cycle = cardCycle(HDFC, now);
    const rows: CycleTransaction[] = [
      spend(10, 9, 2000),
      { amount_minor: 150000, transaction_type: 'transfer',
        transaction_date: new Date(at(2026, 9, 22)).toISOString() },
      { amount_minor: 50000, transaction_type: 'income',
        transaction_date: new Date(at(2026, 9, 23)).toISOString() },
    ];
    const totals = cycleTotals(rows, cycle, HDFC);
    expect(totals.paidSinceStatementMinor).toBe(200000);
    expect(totals.outstandingMinor).toBe(0);
  });

  it('never reports a negative amount owed', () => {
    // Overpaying leaves a credit on the card, not a debt owed back to you,
    // and "you owe -Rs 500" reads as a bug.
    const now = at(2026, 9, 25);
    const cycle = cardCycle(HDFC, now);
    const totals = cycleTotals([
      spend(10, 9, 500),
      { amount_minor: 900_00, transaction_type: 'transfer',
        transaction_date: new Date(at(2026, 9, 22)).toISOString() },
    ], cycle, HDFC);
    expect(totals.outstandingMinor).toBe(0);
  });
});

describe('how much of the limit is gone', () => {
  it('counts both the billed and the accruing cycle', () => {
    // The issuer does not wait for a statement before reducing what is left
    // to spend, so neither does this.
    const totals = { currentCycleMinor: 500000, lastStatementMinor: 500000,
                     paidSinceStatementMinor: 0, outstandingMinor: 500000 };
    expect(limitUsedPercent(totals, HDFC)).toBe(50);
  });

  it('says nothing when no limit is known', () => {
    const totals = { currentCycleMinor: 1, lastStatementMinor: 0,
                     paidSinceStatementMinor: 0, outstandingMinor: 0 };
    expect(limitUsedPercent(totals, { statementDay: 18, dueDay: 8 })).toBeNull();
    expect(limitUsedPercent(totals, { statementDay: 18, dueDay: 8, creditLimitMinor: 0 }))
      .toBeNull();
  });
});

/**
 * An instalment plan is a commitment, not a purchase.
 *
 * It shows up nowhere in a month's spending until the month it lands in,
 * which is how people end up with more running at once than they meant to.
 */
describe('an instalment plan', () => {
  const phone: EmiPlan = {
    name: 'iPhone', monthlyMinor: 6_500_00, months: 12,
    startedAt: new Date(at(2026, 3, 10)).toISOString(),
  };

  it('counts the instalments that have actually been taken', () => {
    // March, April, May, June, July, August, September = 7.
    const progress = emiProgress(phone, at(2026, 9, 20));
    expect(progress.paidCount).toBe(7);
    expect(progress.remainingCount).toBe(5);
    expect(progress.remainingMinor).toBe(5 * 6_500_00);
  });

  it('does not count this month before its day arrives', () => {
    // The 5th of September; the instalment falls on the 10th.
    expect(emiProgress(phone, at(2026, 9, 5)).paidCount).toBe(6);
  });

  it('knows when the last instalment falls', () => {
    expect(new Date(emiProgress(phone, at(2026, 9, 20)).finishesAt).toISOString().slice(0, 10))
      .toBe('2027-02-10');
  });

  it('reports a finished plan as finished, not as overdue', () => {
    const done = emiProgress(phone, at(2028, 1, 1));
    expect(done.isFinished).toBe(true);
    expect(done.remainingCount).toBe(0);
    expect(done.remainingMinor).toBe(0);
    // Never more than the plan holds, however long ago it ended.
    expect(done.paidCount).toBe(12);
  });

  it('counts by the calendar, not by payments seen in the ledger', () => {
    // The bank takes the instalment whether or not the app saw the alert. A
    // plan that under-reported because one notification was missed would tell
    // somebody they owe less than they do.
    const started: EmiPlan = {
      name: 'Laptop', monthlyMinor: 5000_00, months: 6,
      startedAt: new Date(at(2026, 1, 31)).toISOString(),
    };
    // A start day of the 31st, run into February.
    expect(emiProgress(started, at(2026, 2, 28)).paidCount).toBe(2);
  });

  it('adds up what leaves every month across all plans', () => {
    const finished: EmiPlan = {
      name: 'Old TV', monthlyMinor: 2000_00, months: 3,
      startedAt: new Date(at(2025, 1, 1)).toISOString(),
    };
    expect(monthlyEmiLoad([phone, finished], at(2026, 9, 20))).toBe(6_500_00);
  });
});

/**
 * Which rows are the card's, and which way each one points.
 *
 * A transfer is the only ambiguous kind: on a card, money arriving is a
 * repayment and money leaving is a purchase, and both are recorded as the same
 * transaction_type. Reading the type alone counts a payment made FROM the card
 * as a payment made TO it, and quietly cancels out real spending.
 */
describe('reading one card out of the ledger', () => {
  const CARD = 'card-1';
  const BANK = 'bank-1';
  const on = (day: number) => new Date(at(2026, 9, day)).toISOString();

  it('ignores rows belonging to other accounts', () => {
    const rows = cardLedger([
      { amount_minor: 100, transaction_type: 'expense', transaction_date: on(1), account_id: BANK },
      { amount_minor: 200, transaction_type: 'expense', transaction_date: on(2), account_id: CARD },
    ], CARD);
    expect(rows.map((r) => r.amount_minor)).toEqual([200]);
  });

  it('treats money arriving on the card as a repayment', () => {
    const rows = cardLedger([
      { amount_minor: 500, transaction_type: 'transfer', transaction_date: on(3),
        account_id: BANK, to_account_id: CARD },
    ], CARD);
    expect(rows[0].transaction_type).toBe('transfer');
  });

  it('treats money leaving the card as spending, not a repayment', () => {
    // Same transaction_type, opposite meaning. Counted as a repayment it would
    // cancel out real spending and under-report what is owed.
    const rows = cardLedger([
      { amount_minor: 500, transaction_type: 'transfer', transaction_date: on(3),
        account_id: CARD, to_account_id: BANK },
    ], CARD);
    expect(rows[0].transaction_type).toBe('expense');
  });

  it('leaves an ordinary purchase and a refund alone', () => {
    const rows = cardLedger([
      { amount_minor: 100, transaction_type: 'expense', transaction_date: on(4), account_id: CARD },
      { amount_minor: 60, transaction_type: 'income', transaction_date: on(5), account_id: CARD },
    ], CARD);
    expect(rows.map((r) => r.transaction_type)).toEqual(['expense', 'income']);
  });

  it('feeds cycleTotals the right answer end to end', () => {
    const now = at(2026, 9, 25);
    const terms: CardTerms = { statementDay: 18, dueDay: 8 };
    const cycle = cardCycle(terms, now);
    const totals = cycleTotals(cardLedger([
      { amount_minor: 200000, transaction_type: 'expense', transaction_date: on(10),
        account_id: CARD },
      // Paid off from the bank - reduces what is owed.
      { amount_minor: 50000, transaction_type: 'transfer', transaction_date: on(22),
        account_id: BANK, to_account_id: CARD },
      // Spent from the card - must NOT reduce it.
      { amount_minor: 30000, transaction_type: 'transfer', transaction_date: on(23),
        account_id: CARD, to_account_id: BANK },
    ], CARD), cycle, terms);

    expect(totals.lastStatementMinor).toBe(200000);
    expect(totals.paidSinceStatementMinor).toBe(50000);
    expect(totals.currentCycleMinor).toBe(30000);
    expect(totals.outstandingMinor).toBe(150000);
  });
});

/**
 * A due date is a day, not an instant.
 *
 * Measured from the current moment, a card went overdue one second past
 * midnight on its own due date - alarming somebody on the very morning the
 * payment is due - and, because the leftover hours then rounded the wrong way,
 * a card a full day late still read as "due today".
 */
describe('the due date is a whole day', () => {
  const morningOfTheDueDate = Date.UTC(2026, 9, 8, 9, 30);   // 8 Oct, 09:30
  const lateOnTheDueDate = Date.UTC(2026, 9, 8, 23, 59);
  const nextMorning = Date.UTC(2026, 9, 9, 9, 30);

  it('is not overdue at any hour of the due date itself', () => {
    for (const now of [morningOfTheDueDate, lateOnTheDueDate]) {
      const cycle = cardCycle(HDFC, now);
      expect(new Date(cycle.dueAt).toISOString().slice(0, 10)).toBe('2026-10-08');
      expect(cycle.daysUntilDue).toBe(0);
      expect(cycle.isOverdue).toBe(false);
    }
  });

  it('is one day overdue the next morning, not still due today', () => {
    const cycle = cardCycle(HDFC, nextMorning);
    expect(cycle.daysUntilDue).toBe(-1);
    expect(cycle.isOverdue).toBe(true);
  });

  it('reports the same number of days whatever time of day it is asked', () => {
    // Otherwise a countdown changes as the user scrolls past midnight, and two
    // cards on one screen can disagree about what day it is.
    const early = cardCycle(HDFC, Date.UTC(2026, 9, 3, 0, 1));
    const late = cardCycle(HDFC, Date.UTC(2026, 9, 3, 23, 59));
    expect(early.daysUntilDue).toBe(late.daysUntilDue);
    expect(early.daysUntilStatement).toBe(late.daysUntilStatement);
  });
});
