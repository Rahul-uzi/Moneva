// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CashWithdrawalModal } from './CashWithdrawalModal';
import type { Account } from '../../types/api';

/**
 * The reported bug was "Out of" showing Cash. These pin the redesign to what
 * it is for: money leaves a BANK and lands in CASH, and nothing else is
 * offered on either side.
 */

const post = vi.fn();
vi.mock('../../services/apiClient', () => ({
  apiClient: { post: (...a: unknown[]) => post(...a) },
}));

const acc = (over: Partial<Account>): Account => ({
  id: 'a', user_id: 'u', name: 'Account', account_type: 'asset', currency: 'INR',
  opening_balance_minor: 0, is_active: true, created_at: '', updated_at: '', ...over,
});

// Cash FIRST, deliberately: the old dropdown showed whichever came first.
const ACCOUNTS = [
  acc({ id: 'cash', name: 'Cash', balance_paise: 42000 }),
  acc({ id: 'bank', name: 'City Bank Savings', balance_paise: 2500000 }),
  acc({ id: 'card', name: 'Rewards Card', account_type: 'liability' }),
];

// A block body, not an expression: a function RETURNED from beforeEach is run
// by Vitest as that test's cleanup - and mockResolvedValue returns the mock,
// so the expression form called post() once after every test.
beforeEach(() => {
  post.mockResolvedValue({ data: { id: 'tx' } });
});
afterEach(() => { cleanup(); post.mockReset(); });

const open = (accounts = ACCOUNTS, onSuccess = vi.fn()) =>
  render(<CashWithdrawalModal isOpen accounts={accounts} onClose={vi.fn()} onSuccess={onSuccess} />);

/** Types an amount on the sheet's own number pad, key by key. */
const tap = (value: string) => {
  for (const ch of value) {
    fireEvent.click(screen.getByRole('button', { name: ch === '.' ? 'Decimal point' : ch }));
  }
};

describe('Cash withdrawal', () => {
  it('takes the money out of the bank', () => {
    open();
    expect(screen.getByRole('button', { name: /^From: City Bank Savings/ })).toBeTruthy();
  });

  it('never offers cash as somewhere to take it from', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /^From:/ }));
    const from = screen.getByRole('radiogroup', { name: 'Take it out of' });
    expect(within(from).getByRole('radio', { name: /City Bank Savings/ })).toBeTruthy();
    expect(within(from).getByRole('radio', { name: /Rewards Card/ })).toBeTruthy();
    expect(within(from).queryByRole('radio', { name: /^Cash$/ })).toBeNull();
  });

  it('puts the money into cash', () => {
    open();
    expect(screen.getByRole('button', { name: /^To: Cash/ })).toBeTruthy();
  });

  it('shows what the bank will hold afterwards, as it is typed on the pad', () => {
    open();
    tap('4000');
    expect(screen.getByText('₹21,000.00 left in City Bank Savings')).toBeTruthy();
  });

  it('fills a common note in one tap', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '₹2,000' }));
    expect(screen.getByRole('button', { name: /Withdraw ₹2,000\.00/ })).toBeTruthy();
  });

  it('warns, without blocking, when it is more than the bank holds', () => {
    open();
    tap('30000');
    expect(screen.getByText(/More than the ₹25,000\.00 in City Bank Savings/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Withdraw ₹30,000\.00/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('records a transfer from the bank to cash, not an expense', async () => {
    const onSuccess = vi.fn();
    open(ACCOUNTS, onSuccess);
    tap('2000');
    fireEvent.click(screen.getByRole('button', { name: /Withdraw ₹2,000\.00/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/transactions');
    expect(body).toMatchObject({
      transaction_type: 'transfer',
      account_id: 'bank',
      to_account_id: 'cash',
      amount_minor: 200000,
    });
    expect(body).not.toHaveProperty('category_id');
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('refuses an empty amount and says so', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /^Withdraw$/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/how much/i);
    expect(post).not.toHaveBeenCalled();
  });

  it('adds a cash account in place, then uses it', async () => {
    post.mockImplementation((url: string) =>
      url === '/accounts'
        ? Promise.resolve({ data: acc({ id: 'new-cash', name: 'Cash' }) })
        : Promise.resolve({ data: { id: 'tx' } }));
    open([acc({ id: 'bank', name: 'City Bank Savings' })]);

    fireEvent.click(screen.getByRole('button', { name: /^To: Add cash/ }));
    fireEvent.click(screen.getByRole('button', { name: /New cash account/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^To: Cash/ })).toBeTruthy());
    expect(post.mock.calls[0]).toEqual(['/accounts', { name: 'Cash', account_type: 'asset', opening_balance_minor: 0 }]);
  });

  it('says what is missing when there is no bank to take it from', () => {
    open([acc({ id: 'cash', name: 'Cash' })]);
    expect(screen.getByText(/Add the bank account you took it out of first/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /^Withdraw$/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
