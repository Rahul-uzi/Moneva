import { describe, expect, it } from 'vitest';
import { planRecategorise } from './recategorise';
import type { Category, Transaction } from '../types/api';

/**
 * Repairing rows a broken matcher filed.
 *
 * The real account had a petrol pump, a supermarket, a wifi bill and money
 * sent to a friend all under Food & Dining, because one bare "Google Pay" row
 * matched every payment made through that app.
 *
 * The two rules that make a bulk edit safe are tested here: it never clears a
 * category it cannot replace, and it never reads the wrong rows back as
 * evidence.
 */
const CATEGORIES = [
  'Food & Dining', 'Fuel', 'Groceries', 'Utilities', 'Shopping', 'Other',
].map((name) => ({ id: `exp-${name}`, name, type: 'expense' }))
  .concat(['Salary', 'Other Income'].map((name) => ({ id: `inc-${name}`, name, type: 'income' }))) as Category[];

let n = 0;
const tx = (over: Partial<Transaction>): Transaction => ({
  id: `t${(n += 1)}`,
  transaction_type: 'expense',
  amount_minor: 1000,
  currency: 'INR',
  description: '',
  transaction_date: '2026-09-20T00:00:00Z',
  category_id: null,
  account_id: 'a1',
  ...over,
} as Transaction);

describe('it repairs the rows the bug mis-filed', () => {
  it('moves a petrol pump out of Food & Dining', () => {
    const p = planRecategorise(
      [tx({ description: 'Google Pay - Indian Oil Petrol Pump', category_id: 'exp-Food & Dining' })],
      CATEGORIES,
    );
    expect(p).toHaveLength(1);
    expect(p[0].fromName).toBe('Food & Dining');
    expect(p[0].toName).toBe('Fuel');
  });

  it('moves a supermarket to Groceries', () => {
    const p = planRecategorise(
      [tx({ description: 'Google Pay - Dmart', category_id: 'exp-Food & Dining' })],
      CATEGORIES,
    );
    expect(p[0].toName).toBe('Groceries');
  });

  it('fills in a row that had no category at all', () => {
    const p = planRecategorise([tx({ description: 'DMART Return', category_id: null })], CATEGORIES);
    expect(p[0].fromName).toBeNull();
    expect(p[0].toName).toBe('Groceries');
  });

  it('carries a reason, so the preview can say why', () => {
    const p = planRecategorise([tx({ description: 'Swiggy order' })], CATEGORIES);
    expect(p[0].reason).toBeTruthy();
  });
});

describe('what it refuses to touch', () => {
  it('never clears a category it cannot replace', () => {
    // "Vishal" places nothing. Leaving a hand-picked category alone matters
    // more than tidiness - this is somebody's ledger, not a cache.
    const p = planRecategorise(
      [tx({ description: 'Google Pay - Vishal', category_id: 'exp-Other' })],
      CATEGORIES,
    );
    expect(p).toHaveLength(0);
  });

  it('leaves a row that is already right alone', () => {
    const p = planRecategorise(
      [tx({ description: 'Swiggy', category_id: 'exp-Food & Dining' })],
      CATEGORIES,
    );
    expect(p).toHaveLength(0);
  });

  it('ignores income', () => {
    const p = planRecategorise(
      [tx({ transaction_type: 'income', description: 'Google Pay - KARAN', category_id: 'inc-Other Income' })],
      CATEGORIES,
    );
    expect(p).toHaveLength(0);
  });

  it('ignores transfers', () => {
    const p = planRecategorise(
      [tx({ transaction_type: 'transfer', description: 'Google Pay - Dmart' })],
      CATEGORIES,
    );
    expect(p).toHaveLength(0);
  });

  it('ignores a row with no description to read', () => {
    expect(planRecategorise([tx({ description: '   ' })], CATEGORIES)).toHaveLength(0);
  });
});

describe('it does not learn from the rows it is repairing', () => {
  it('will not spread one wrong category to the rest', () => {
    /* The bug in one line. With history on, the first row below teaches the
       matcher that anything "Google Pay" is Food & Dining, and the petrol
       pump and the supermarket come back as Food & Dining - repaired into
       exactly the state they were being repaired from. */
    const plan = planRecategorise([
      tx({ description: 'Google Pay', category_id: 'exp-Food & Dining' }),
      tx({ description: 'Google Pay - Indian Oil Petrol Pump', category_id: 'exp-Food & Dining' }),
      tx({ description: 'Google Pay - Dmart', category_id: 'exp-Food & Dining' }),
      tx({ description: 'Google Pay - Wifi', category_id: 'exp-Food & Dining' }),
    ], CATEGORIES);

    const by = Object.fromEntries(plan.map((p) => [p.description, p.toName]));
    expect(by['Google Pay - Indian Oil Petrol Pump']).toBe('Fuel');
    expect(by['Google Pay - Dmart']).toBe('Groceries');
    expect(by['Google Pay - Wifi']).toBe('Utilities');
    // The bare rail row places nothing, so it is left exactly as it is.
    expect(by['Google Pay']).toBeUndefined();
  });
});
