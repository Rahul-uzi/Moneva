import { describe, expect, it } from 'vitest';
import { suggestCategory } from './categorise';

/**
 * The bug that put everything in Food & Dining.
 *
 * History matching compares a normalised payee by CONTAINMENT, because bank
 * narrations are noisy and "UPI/SWIGGY LTD/9876" and "Swiggy" are one payee.
 * The payment rail was being left in that key, and "googlepay" sits inside
 * "googlepayneha", "googlepaydmart" and every other row that travelled
 * through the same app. One bare "Google Pay" row therefore matched all of
 * them, and whatever it was filed under spread to every payment the person
 * ever made with that app.
 *
 * In the real account it was Food & Dining, so a petrol pump, a supermarket
 * and money sent to a friend were all Food & Dining.
 *
 * The rail is not the payee. These tests hold that line.
 */
const CATEGORIES = [
  'Education', 'Entertainment', 'Food & Dining', 'Fuel', 'Groceries', 'Health',
  'Other', 'Rent & Housing', 'Shopping', 'Transport', 'Utilities',
].map((name) => ({ id: `exp-${name}`, name, type: 'expense' }))
  .concat(['Business', 'Investments', 'Other Income', 'Salary']
    .map((name) => ({ id: `inc-${name}`, name, type: 'income' })));

/** The row that poisoned the real account. */
const POISON = [{ description: 'Google Pay', category_id: 'exp-Food & Dining' }];

const ask = (merchant: string, history = POISON, text = '') =>
  suggestCategory({ merchant, text: text || merchant, kind: 'debit', categories: CATEGORIES, history });

describe('a bare payment-app row no longer infects every other payment', () => {
  it('does not make a petrol pump Food & Dining', () => {
    const s = ask('Google Pay - Indian Oil', POISON, 'Google Pay - Indian Oil Petrol Pump');
    expect(s.categoryName).not.toBe('Food & Dining');
    expect(s.categoryName).toBe('Fuel');
  });

  it('does not make a supermarket Food & Dining', () => {
    const s = ask('Google Pay - Dmart');
    expect(s.categoryName).toBe('Groceries');
  });

  it('does not make the wifi bill Food & Dining', () => {
    const s = ask('Google Pay - Wifi');
    expect(s.categoryName).toBe('Utilities');
  });

  it('leaves money sent to a person uncategorised rather than guessing', () => {
    // There is nothing in "Neha" that places it, and a wrong category is
    // worse than none - it is what quietly corrupts a budget.
    const s = ask('Google Pay - Neha');
    expect(s.categoryId).toBeNull();
  });

  it('is not fooled by the rail appearing twice', () => {
    const s = ask('UPI/Google Pay/DMART');
    expect(s.categoryName).toBe('Groceries');
  });

  it.each([
    'PhonePe - Dmart', 'Paytm - Dmart', 'BHIM - Dmart',
    'UPI-DMART', 'Paid to Dmart', 'Sent to Dmart',
  ])('strips %s down to the payee', (desc) => {
    expect(ask(desc).categoryName).toBe('Groceries');
  });
});

describe('what history is still allowed to do', () => {
  it('still reuses a decision about a real payee', () => {
    // The whole point of history: the person's own past choice beats the
    // keyword table. "Swiggy" filed under Groceries stays Groceries.
    const s = ask('Google Pay - Swiggy', [
      { description: 'Swiggy', category_id: 'exp-Groceries' },
    ]);
    expect(s.source).toBe('history');
    expect(s.categoryName).toBe('Groceries');
  });

  it('matches the same payee across different rails', () => {
    const s = ask('PhonePe - Swiggy', [
      { description: 'Google Pay - Swiggy', category_id: 'exp-Groceries' },
    ]);
    expect(s.source).toBe('history');
  });

  it('still sees through a noisy narration to the payee', () => {
    const s = ask('SWIGGY', [
      { description: 'UPI/SWIGGY LTD/987654', category_id: 'exp-Food & Dining' },
    ]);
    expect(s.source).toBe('history');
  });

  it('does not match two different people through a shared rail', () => {
    const s = ask('Google Pay - Arjun', [
      { description: 'Google Pay - Neha', category_id: 'exp-Food & Dining' },
    ]);
    expect(s.categoryId).toBeNull();
  });
});

describe('money coming in is untouched by any of this', () => {
  it('files a credit as income, never as a spending category', () => {
    const s = suggestCategory({
      merchant: 'Google Pay - ARJUN MEHTA', text: 'Google Pay - ARJUN MEHTA',
      kind: 'credit', categories: CATEGORIES, history: POISON,
    });
    expect(s.categoryName).toBe('Other Income');
  });
});
