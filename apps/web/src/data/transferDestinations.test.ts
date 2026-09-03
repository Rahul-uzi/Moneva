import { describe, it, expect } from 'vitest';
import {
  BANKS,
  WALLETS,
  MERCHANTS,
  OTHER_DESTINATION_ID,
  findDestination,
  isExternalDestination,
} from './transferDestinations';

const ALL = [...BANKS, ...WALLETS, ...MERCHANTS];

describe('transfer destinations', () => {
  it('gives every destination a unique id', () => {
    const ids = ALL.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never collides with a UUID account id', () => {
    // Account ids are UUIDs; these carry a prefix so the same <select> can hold
    // both without one being mistaken for the other.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(ALL.every((d) => d.id.includes(':') && !uuid.test(d.id))).toBe(true);
    expect(OTHER_DESTINATION_ID.includes(':')).toBe(true);
  });

  it('treats every listed destination as external', () => {
    // External is what makes the entry an expense rather than a transfer, so a
    // miss here would keep spent money inside net worth.
    expect(ALL.every((d) => isExternalDestination(d.id))).toBe(true);
    expect(isExternalDestination(OTHER_DESTINATION_ID)).toBe(true);
  });

  it('does not treat an account id as external', () => {
    expect(isExternalDestination('7d6bfa64-d62f-4a1b-9c3d-4e5f6a7b8c9d')).toBe(false);
    expect(isExternalDestination('')).toBe(false);
  });

  it('routes food apps to Food & Dining', () => {
    expect(findDestination('app:swiggy')?.categoryHint).toBe('Food & Dining');
    expect(findDestination('app:zomato')?.categoryHint).toBe('Food & Dining');
  });

  it('routes rides to Transport and shops to Shopping', () => {
    expect(findDestination('app:uber')?.categoryHint).toBe('Transport');
    expect(findDestination('app:ola')?.categoryHint).toBe('Transport');
    expect(findDestination('app:amazon')?.categoryHint).toBe('Shopping');
    expect(findDestination('app:flipkart')?.categoryHint).toBe('Shopping');
  });

  it('routes quick-commerce to Groceries', () => {
    expect(findDestination('app:blinkit')?.categoryHint).toBe('Groceries');
    expect(findDestination('app:zepto')?.categoryHint).toBe('Groceries');
  });

  it('does not pretend a bank transfer is shopping', () => {
    // A bank has no natural spending category; guessing one would file money
    // under something the user never bought.
    expect(BANKS.every((b) => b.categoryHint === 'Other')).toBe(true);
    expect(BANKS.every((b) => b.kind === 'bank')).toBe(true);
  });

  it('hints only at categories the app actually seeds', () => {
    // Hints are matched by name against the user's real categories, so a name
    // that does not exist would silently fall back for everyone.
    const seeded = new Set([
      'Food & Dining', 'Groceries', 'Transport', 'Fuel', 'Rent & Housing',
      'Utilities', 'Shopping', 'Health', 'Entertainment', 'Education', 'Other',
    ]);
    const missing = ALL.map((d) => d.categoryHint).filter((h) => h && !seeded.has(h));
    expect(missing).toEqual([]);
  });

  it('returns nothing for an unknown id', () => {
    expect(findDestination('app:not-a-real-app')).toBeUndefined();
  });

  it('includes the platforms people actually use', () => {
    const labels = ALL.map((d) => d.label);
    for (const name of ['Swiggy', 'Amazon', 'Blinkit', 'Uber', 'HDFC Bank', 'Paytm']) {
      expect(labels).toContain(name);
    }
  });
});
