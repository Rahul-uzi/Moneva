import { describe, expect, it } from 'vitest';
import { suggestCategory } from './categorise';

/** The categories a real MONEVA account actually has - read from the API. */
const CATEGORIES = [
  'Education', 'Entertainment', 'Food & Dining', 'Fuel', 'Groceries', 'Health',
  'Other', 'Rent & Housing', 'Shopping', 'Transport', 'Utilities',
].map((name) => ({ id: `exp-${name}`, name, type: 'expense' }))
  .concat(['Business', 'Investments', 'Other Income', 'Salary']
    .map((name) => ({ id: `inc-${name}`, name, type: 'income' })));

const ask = (over: Partial<Parameters<typeof suggestCategory>[0]> = {}) =>
  suggestCategory({ text: '', kind: 'debit', categories: CATEGORIES, ...over });

describe('what you did last time wins', () => {
  it('reuses the category from a past payment to the same payee', () => {
    const s = ask({
      merchant: 'Swiggy',
      history: [{ description: 'Swiggy', category_id: 'exp-Groceries' }],
    });
    // Groceries, not Food & Dining: the person's own past decision beats the
    // table, which is the whole point of trying history first.
    expect(s.categoryId).toBe('exp-Groceries');
    expect(s.source).toBe('history');
    expect(s.reason).toContain('before');
  });

  it('sees through a noisy bank narration', () => {
    const s = ask({
      merchant: 'SWIGGY',
      history: [{ description: 'UPI/SWIGGY LTD/987654', category_id: 'exp-Food & Dining' }],
    });
    expect(s.source).toBe('history');
    expect(s.categoryId).toBe('exp-Food & Dining');
  });

  it('ignores history pointing at a category that no longer exists', () => {
    const s = ask({
      merchant: 'Swiggy',
      history: [{ description: 'Swiggy', category_id: 'exp-Deleted' }],
    });
    expect(s.source).toBe('merchant');
    expect(s.categoryId).toBe('exp-Food & Dining');
  });

  it('does not match on a payee name too short to mean anything', () => {
    const s = ask({ merchant: 'JB', history: [{ description: 'JB', category_id: 'exp-Shopping' }] });
    expect(s.source).not.toBe('history');
  });
});

describe('the merchant table', () => {
  it('places the merchants the app already knows', () => {
    expect(ask({ merchant: 'Zomato' }).categoryId).toBe('exp-Food & Dining');
    expect(ask({ merchant: 'Uber' }).categoryId).toBe('exp-Transport');
    expect(ask({ merchant: 'Netflix' }).categoryId).toBe('exp-Entertainment');
    expect(ask({ merchant: 'Blinkit' }).categoryId).toBe('exp-Groceries');
    expect(ask({ merchant: 'Apollo Pharmacy' }).categoryId).toBe('exp-Health');
  });

  it('finds the merchant inside a full message, not just as the payee', () => {
    const s = ask({ text: 'Rs.450 debited for UPI/ZOMATO ONLINE/9812' });
    expect(s.categoryId).toBe('exp-Food & Dining');
  });

  it('skips a hint that says nothing', () => {
    // Paytm and Google Pay are hinted "Other" - a wallet is not a category,
    // and filing everything paid by wallet under Other would be worse than
    // leaving it blank.
    expect(ask({ merchant: 'Paytm' }).source).not.toBe('merchant');
  });
});

describe('words in the message', () => {
  it('catches the long tail no table covers', () => {
    expect(ask({ text: 'Rs.2000 spent at HP PETROL PUMP' }).categoryId).toBe('exp-Fuel');
    expect(ask({ text: 'paid to CITY HOSPITAL' }).categoryId).toBe('exp-Health');
    expect(ask({ text: 'monthly rent to landlord' }).categoryId).toBe('exp-Rent & Housing');
    expect(ask({ text: 'FASTAG recharge' }).categoryId).toBe('exp-Transport');
    expect(ask({ text: 'paid COURSERA course fee' }).categoryId).toBe('exp-Education');
  });

  it('prefers fuel over transport at a petrol pump', () => {
    // A petrol pump is fuel, not a taxi - and "toll"/"parking" would both
    // otherwise be plausible on the same message.
    expect(ask({ text: 'INDIAN OIL fuel purchase, toll road' }).categoryId).toBe('exp-Fuel');
  });
});

describe('money coming in', () => {
  it('recognises a salary credit', () => {
    const s = ask({ kind: 'credit', text: 'Salary credited from ACME CORP' });
    expect(s.categoryId).toBe('inc-Salary');
    expect(s.source).toBe('keyword');
  });

  it('falls back to Other Income without claiming to know', () => {
    const s = ask({ kind: 'credit', text: 'Rs.500 credited from RAHUL' });
    expect(s.categoryId).toBe('inc-Other Income');
    expect(s.source).toBe('none');
  });

  it('never files income under an expense category', () => {
    const s = ask({ kind: 'credit', text: 'refund from Swiggy' });
    expect(s.categoryId).not.toBe('exp-Food & Dining');
  });
});

describe('refusing to guess', () => {
  it('returns nothing when nothing matches', () => {
    const s = ask({ merchant: 'Ramesh Kumar', text: 'Rs.500 sent to Ramesh Kumar' });
    expect(s.categoryId).toBeNull();
    expect(s.source).toBe('none');
    expect(s.reason).toBeNull();
  });

  it('returns nothing when the user has no categories at all', () => {
    const s = suggestCategory({ text: 'Swiggy order', kind: 'debit', categories: [] });
    expect(s.categoryId).toBeNull();
  });

  it('copes with empty and missing input', () => {
    expect(ask({ text: '' }).categoryId).toBeNull();
    expect(ask({ merchant: undefined, text: '' }).source).toBe('none');
  });

  it('always explains itself when it does suggest something', () => {
    for (const s of [
      ask({ merchant: 'Zomato' }),
      ask({ text: 'petrol' }),
      ask({ merchant: 'Swiggy', history: [{ description: 'Swiggy', category_id: 'exp-Groceries' }] }),
    ]) {
      expect(s.categoryId).not.toBeNull();
      expect(s.reason).toBeTruthy();
    }
  });
});

describe('short keywords need a word boundary', () => {
  it('does not read "Motorola" as an Ola ride', () => {
    // "ola" as a bare substring matches Motorola, Sholapur and chocolate.
    expect(ask({ text: 'Paid to MOTOROLA service centre' }).categoryId)
      .not.toBe('exp-Transport');
    expect(ask({ text: 'CHOCOLATE shop' }).categoryId).not.toBe('exp-Transport');
  });

  it('still catches the real thing', () => {
    expect(ask({ text: 'OLA cab ride' }).categoryId).toBe('exp-Transport');
    expect(ask({ text: 'paid via Ola' }).categoryId).toBe('exp-Transport');
  });
});
