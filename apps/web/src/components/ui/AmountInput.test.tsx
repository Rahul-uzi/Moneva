// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AmountInput } from './AmountInput';

/**
 * A balance is the one amount in the app that can be below zero.
 *
 * Everywhere else a negative is meaningless - "-200 spent" is not a thing -
 * so the field refuses one, and that refusal is worth keeping. But a credit
 * card and an overdrawn account really do hold less than nothing, and when
 * the account screen gained a "current balance" field the correct figure for
 * a card was untypeable: the field rejected the minus sign outright.
 *
 * So the relaxation is opt-in, and these tests are as much about the default
 * staying strict as about the exception working.
 */

// Each test renders the field again, and without this they stack in one
// document - the second lookup then finds two inputs and fails on that
// rather than on anything the component did.
afterEach(cleanup);

const typeInto = (value: string) => {
  const input = screen.getByPlaceholderText('0.00');
  fireEvent.change(input, { target: { value } });
  return input as HTMLInputElement;
};

describe('AmountInput, by default', () => {
  it('refuses a negative amount', () => {
    const onChange = vi.fn();
    render(<AmountInput valuePaise={0} onChangePaise={onChange} />);
    typeInto('-500');
    expect(screen.getByText('Amount cannot be negative')).toBeTruthy();
  });

  it('does not report a negative to the parent', () => {
    // The message alone is not enough. If the value still went through, the
    // form would save a figure the field had just called invalid.
    const onChange = vi.fn();
    render(<AmountInput valuePaise={0} onChangePaise={onChange} />);
    typeInto('-500');
    expect(onChange).not.toHaveBeenCalledWith(-50000);
  });

  it('still takes an ordinary amount', () => {
    const onChange = vi.fn();
    render(<AmountInput valuePaise={0} onChangePaise={onChange} />);
    typeInto('250');
    expect(onChange).toHaveBeenCalledWith(25000);
    expect(screen.queryByText('Amount cannot be negative')).toBeNull();
  });
});

describe('AmountInput with allowNegative', () => {
  it('accepts a balance below zero', () => {
    const onChange = vi.fn();
    render(<AmountInput valuePaise={0} onChangePaise={onChange} allowNegative />);
    typeInto('-9000');
    expect(screen.queryByText('Amount cannot be negative')).toBeNull();
    expect(onChange).toHaveBeenCalledWith(-900000);
  });

  it('says nothing while only the minus has been typed', () => {
    /*
     * Caught live, not by reasoning: the guard for this was written AFTER the
     * parse, and rupeesToPaise throws on a lone "-", so it landed in the
     * catch and accused the user of a bad amount the moment they reached for
     * the minus key. It has to be judged before the parse.
     */
    const onChange = vi.fn();
    render(<AmountInput valuePaise={0} onChangePaise={onChange} allowNegative />);
    typeInto('-');
    expect(screen.queryByText('Invalid amount format')).toBeNull();
    expect(screen.queryByText('Amount cannot be negative')).toBeNull();
  });

  it('does not report the half-typed minus as zero', () => {
    // Worse than the error message it replaced: a silent 0 tells the form the
    // balance is nil, and saving there would wipe the account out.
    const onChange = vi.fn();
    render(<AmountInput valuePaise={0} onChangePaise={onChange} allowNegative />);
    typeInto('-');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still refuses text that is not a number', () => {
    const onChange = vi.fn();
    render(<AmountInput valuePaise={0} onChangePaise={onChange} allowNegative />);
    typeInto('abc');
    expect(screen.getByText('Invalid amount format')).toBeTruthy();
  });

  it('shows a negative balance grouped the Indian way', () => {
    render(<AmountInput valuePaise={-1234567} onChangePaise={vi.fn()} allowNegative />);
    expect((screen.getByPlaceholderText('0.00') as HTMLInputElement).value).toBe('-12,345.67');
  });
});
