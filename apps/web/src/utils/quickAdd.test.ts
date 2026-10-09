import { describe, expect, it } from 'vitest';
import {
  buildDescription,
  describeWhen,
  payeeFromDescription,
  payeeSuggestions,
} from './quickAdd';

describe('payeeFromDescription', () => {
  it('takes the name before the note', () => {
    expect(payeeFromDescription('Gopal - chai')).toBe('Gopal');
    expect(payeeFromDescription('Swiggy')).toBe('Swiggy');
  });

  // The SMS reader writes bank narrations, and offering one of those back as
  // "someone you paid" would be noise in the one place meant to save typing.
  it('refuses a bank narration as a name', () => {
    expect(payeeFromDescription('UPI/DR/412345678901/GOPAL K/SBIN')).toBeNull();
    expect(payeeFromDescription('Ref 9876543210 transfer')).toBeNull();
  });

  it('refuses nothing and a whole paragraph', () => {
    expect(payeeFromDescription('')).toBeNull();
    expect(payeeFromDescription(null)).toBeNull();
    expect(payeeFromDescription('a'.repeat(40))).toBeNull();
  });
});

describe('buildDescription', () => {
  it('joins the two halves the way the sheet always has', () => {
    expect(buildDescription('Gopal', 'chai')).toBe('Gopal - chai');
  });
  it('keeps whichever half exists', () => {
    expect(buildDescription('Gopal', '  ')).toBe('Gopal');
    expect(buildDescription('', 'chai')).toBe('chai');
    expect(buildDescription(' ', ' ')).toBeNull();
  });
});

const history = [
  { description: 'Neha', transaction_type: 'expense', transaction_date: '2026-10-08T10:00:00Z' },
  { description: 'Gopal - chai', transaction_type: 'expense', transaction_date: '2026-10-09T10:00:00Z' },
  { description: 'Gopal', transaction_type: 'expense', transaction_date: '2026-10-01T10:00:00Z' },
  { description: 'Acme Corp', transaction_type: 'income', transaction_date: '2026-10-05T10:00:00Z' },
  { description: 'UPI/DR/412345678901/X', transaction_type: 'expense', transaction_date: '2026-10-09T11:00:00Z' },
];

describe('payeeSuggestions', () => {
  it('offers the people you actually paid, newest first, once each', () => {
    const out = payeeSuggestions({ query: '', type: 'expense', history });
    expect(out.map((s) => s.label)).toEqual(['Gopal', 'Neha']);
    expect(out.every((s) => s.source === 'recent')).toBe(true);
  });

  it('keeps income and expense apart', () => {
    const out = payeeSuggestions({ query: '', type: 'income', history });
    expect(out.map((s) => s.label)).toEqual(['Acme Corp']);
  });

  it('never offers a shop as somewhere your income came from', () => {
    const out = payeeSuggestions({ query: 'sw', type: 'income', history: [] });
    expect(out).toEqual([]);
  });

  it('falls back to popular apps for someone with no history yet', () => {
    const out = payeeSuggestions({ query: '', type: 'expense', history: [] });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) => s.source === 'catalogue')).toBe(true);
  });

  it('ranks names that start with what was typed first', () => {
    const out = payeeSuggestions({ query: 'sw', type: 'expense', history: [] });
    expect(out[0].label).toBe('Swiggy');
    // "Swiggy Instamart" also starts with it; anything merely containing it
    // comes after both.
    expect(out.map((s) => s.label)).toContain('Swiggy Instamart');
  });

  it('puts a name you used ahead of the catalogue', () => {
    const out = payeeSuggestions({
      query: 'g',
      type: 'expense',
      history: [{ description: 'Gopal', transaction_type: 'expense', transaction_date: '2026-10-09' }],
    });
    expect(out[0]).toMatchObject({ label: 'Gopal', source: 'recent' });
  });

  it('does not suggest the exact name already typed', () => {
    const out = payeeSuggestions({ query: 'gopal', type: 'expense', history });
    expect(out.map((s) => s.label.toLowerCase())).not.toContain('gopal');
  });

  it('does not repeat a catalogue entry you have already used', () => {
    const loose = payeeSuggestions({
      query: 'swi',
      type: 'expense',
      history: [{ description: 'Swiggy', transaction_type: 'expense', transaction_date: '2026-10-09' }],
    });
    expect(loose.filter((s) => s.label === 'Swiggy')).toHaveLength(1);
    expect(loose[0].source).toBe('recent');
  });

  it('respects the limit', () => {
    expect(payeeSuggestions({ query: 'a', type: 'expense', history: [], limit: 3 })).toHaveLength(3);
  });
});

describe('describeWhen', () => {
  const now = new Date(2026, 9, 9, 20, 40); // 9 Oct 2026, 8:40 pm local

  it('says Now until the user picks a time', () => {
    expect(describeWhen('2026-10-01T09:00', false, now)).toBe('Now');
  });

  it('names today and yesterday the way a person would', () => {
    expect(describeWhen('2026-10-09T09:05', true, now)).toBe('Today, 9:05 am');
    expect(describeWhen('2026-10-08T21:30', true, now)).toBe('Yesterday, 9:30 pm');
  });

  it('gives a short date further back, and the year only when it differs', () => {
    expect(describeWhen('2026-10-01T09:00', true, now)).toMatch(/^1 Oct, 9:00 am$/);
    expect(describeWhen('2025-12-31T09:00', true, now)).toMatch(/2025/);
  });

  it('survives a value it cannot read', () => {
    expect(describeWhen('nonsense', true, now)).toBe('Now');
  });
});
