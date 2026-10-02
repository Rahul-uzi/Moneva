import { describe, expect, it } from 'vitest';
import { matchBillForPayment, type BillLike } from './billMatch';

/**
 * Recognising an autopay.
 *
 * The case that drove this: Spotify, Rs 69, taken by mandate on the 3rd of
 * every month. The user never taps "Pay Now" - there is nothing to tap - so
 * the bank's SMS is the only evidence the bill was ever settled. Filed as an
 * ordinary expense it counted the rupees twice and left the bill owed.
 *
 * The bar here is deliberately high. Settling the wrong bill rolls its date a
 * month forward and stops reminding someone about money they still owe, so
 * every test below is as much about what must NOT match.
 */
const SPOTIFY: BillLike = {
  id: 'bill-spotify',
  name: 'Spotify',
  amount_minor: 6900,
  due_date: '2026-10-03T00:00:00Z',
  status: 'upcoming',
  recurrence: 'monthly',
};

const on = (iso: string) => Date.parse(iso);

const pay = (over: Partial<Parameters<typeof matchBillForPayment>[0]> = {}) => ({
  amountPaise: 6900,
  kind: 'debit' as const,
  postedAt: on('2026-10-03T06:30:00Z'),
  ...over,
});

describe('the autopay that started this', () => {
  it('matches the bill taken on its due date', () => {
    const m = matchBillForPayment(pay(), [SPOTIFY]);
    expect(m?.bill.id).toBe('bill-spotify');
  });

  it('says so when the alert names the merchant', () => {
    const m = matchBillForPayment(pay({ merchant: 'SPOTIFY INDIA' }), [SPOTIFY]);
    expect(m?.nameMatched).toBe(true);
    expect(m?.reason).toContain('names it');
  });

  it('still matches when the bank names nothing useful', () => {
    // Plenty of mandate SMS say only "UPI-MANDATE" and a reference.
    const m = matchBillForPayment(pay({ merchant: 'UPI MANDATE 4412' }), [SPOTIFY]);
    expect(m?.bill.id).toBe('bill-spotify');
    expect(m?.nameMatched).toBe(false);
  });

  it('accepts a mandate that retried a few days late', () => {
    expect(matchBillForPayment(pay({ postedAt: on('2026-10-09T10:00:00Z') }), [SPOTIFY])).not.toBeNull();
  });
});

describe('what must not be taken for the bill', () => {
  it('ignores a different amount, however close', () => {
    expect(matchBillForPayment(pay({ amountPaise: 6901 }), [SPOTIFY])).toBeNull();
    expect(matchBillForPayment(pay({ amountPaise: 6800 }), [SPOTIFY])).toBeNull();
  });

  it('ignores money coming in', () => {
    expect(matchBillForPayment(pay({ kind: 'credit' }), [SPOTIFY])).toBeNull();
  });

  it('ignores a transfer between the user\'s own accounts', () => {
    expect(matchBillForPayment(pay({ kind: 'transfer' }), [SPOTIFY])).toBeNull();
  });

  it('will not let next month\'s payment settle this month\'s bill', () => {
    // A month early is the dangerous one: same merchant, same amount, and
    // settling it would mark October paid while October is still owed.
    expect(matchBillForPayment(pay({ postedAt: on('2026-09-03T06:30:00Z') }), [SPOTIFY])).toBeNull();
  });

  it('gives up on a payment far later than the due date', () => {
    expect(matchBillForPayment(pay({ postedAt: on('2026-10-25T06:30:00Z') }), [SPOTIFY])).toBeNull();
  });

  it('ignores a bill already paid', () => {
    expect(matchBillForPayment(pay(), [{ ...SPOTIFY, status: 'paid' }])).toBeNull();
  });

  it('ignores a cancelled bill', () => {
    expect(matchBillForPayment(pay(), [{ ...SPOTIFY, status: 'cancelled' }])).toBeNull();
  });

  it('ignores a bill with an unreadable due date', () => {
    expect(matchBillForPayment(pay(), [{ ...SPOTIFY, due_date: 'not a date' }])).toBeNull();
  });

  it('matches nothing when there are no bills', () => {
    expect(matchBillForPayment(pay(), [])).toBeNull();
  });
});

describe('two bills that look alike', () => {
  const NETFLIX: BillLike = {
    id: 'bill-netflix', name: 'Netflix', amount_minor: 6900,
    due_date: '2026-10-04T00:00:00Z', status: 'upcoming', recurrence: 'monthly',
  };

  it('refuses to choose when nothing names either', () => {
    // Same rupees, same week. Guessing here would settle the wrong one.
    expect(matchBillForPayment(pay({ merchant: 'UPI MANDATE' }), [SPOTIFY, NETFLIX])).toBeNull();
  });

  it('picks the one the alert actually names', () => {
    const m = matchBillForPayment(pay({ merchant: 'NETFLIX.COM' }), [SPOTIFY, NETFLIX]);
    expect(m?.bill.id).toBe('bill-netflix');
    expect(m?.nameMatched).toBe(true);
  });

  it('refuses when the alert names both', () => {
    const odd: BillLike = { ...NETFLIX, id: 'bill-spot2', name: 'Spotify Family' };
    expect(matchBillForPayment(pay({ merchant: 'SPOTIFY' }), [SPOTIFY, odd])).toBeNull();
  });
});

describe('name comparison does not fire on scraps', () => {
  it('ignores a bill name too short to mean anything', () => {
    // "EB" would otherwise be found inside half the narrations ever written.
    const eb: BillLike = { ...SPOTIFY, id: 'bill-eb', name: 'EB' };
    const m = matchBillForPayment(pay({ merchant: 'DEBIT CARD FEE' }), [eb]);
    // It can still match on amount and date - it just must not claim the NAME
    // agreed, because "eb" appearing inside "debit" is not a name match.
    expect(m?.nameMatched).toBe(false);
  });

  it('sees through punctuation and case', () => {
    const m = matchBillForPayment(pay({ merchant: 'spotify*in bengaluru' }), [SPOTIFY]);
    expect(m?.nameMatched).toBe(true);
  });
});
