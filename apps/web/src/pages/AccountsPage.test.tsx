// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AccountsPage } from './AccountsPage';
import { useAuthStore } from '../stores/useAuthStore';
import type { Account, User } from '../types/api';

/**
 * The Accounts screen: what is held, what is owed, and the way in to adding,
 * opening and closing an account.
 */

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();
vi.mock('../services/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/apiClient')>()),
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

const USER: User = {
  id: 'u', email: 'person@example.com', display_name: 'Asha Rao', currency: 'INR', timezone: 'Asia/Kolkata',
  is_active: true, email_verified: true, avatar_data_url: null, totp_enabled: false, created_at: '', updated_at: '',
};

const STAMP = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
const BANK: Account = {
  id: 'acc-bank', user_id: 'u', name: 'City Bank Savings', account_type: 'asset', currency: 'INR',
  opening_balance_minor: 10000000, balance_paise: 16000000, is_active: true, ...STAMP,
};
const WALLET: Account = {
  id: 'acc-wallet', user_id: 'u', name: 'Pocket Wallet', account_type: 'asset', currency: 'INR',
  opening_balance_minor: 500000, is_active: true, ...STAMP, // no live balance: the opening one counts
};
const CARD: Account = {
  id: 'acc-card', user_id: 'u', name: 'Rewards Card', account_type: 'liability', currency: 'INR',
  opening_balance_minor: 0, balance_paise: 1000000, is_active: true,
  statement_day: 5, due_day: 25, credit_limit_minor: 10000000, ...STAMP,
};
const LOAN: Account = {
  id: 'acc-loan', user_id: 'u', name: 'Home Loan', account_type: 'liability', currency: 'INR',
  opening_balance_minor: 0, balance_paise: 2000000, is_active: true, ...STAMP,
};

let accounts: Account[];
let accountsError: unknown;
let cardDataError: unknown;

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce'), media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});
beforeEach(() => {
  accounts = [BANK, WALLET, CARD];
  accountsError = null;
  cardDataError = null;
  get.mockImplementation((url: string) => {
    if (url === '/accounts') {
      return accountsError ? Promise.reject(accountsError) : Promise.resolve({ data: accounts });
    }
    if (url === '/transactions' || url === '/emis') {
      return cardDataError ? Promise.reject(cardDataError) : Promise.resolve({ data: [] });
    }
    return Promise.resolve({ data: [] });
  });
  post.mockResolvedValue({ data: {} });
  patch.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: {} });
  useAuthStore.setState({ user: USER, isAuthenticated: true, isInitialized: true, isLoading: false });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const settle = async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
};

const show = async () => {
  render(<MemoryRouter><AccountsPage /></MemoryRouter>);
  await settle();
};

/** The text beside a label, read from the block that holds both. */
const besideLabel = (label: string) => screen.getByText(label).parentElement?.textContent ?? '';
const tab = (name: RegExp) => screen.getByRole('button', { name });

describe('the account list', () => {
  it('lists every account with its balance', async () => {
    await show();
    expect(screen.getByText('3 Active Accounts')).toBeTruthy();
    expect(screen.getByText('City Bank Savings').parentElement?.textContent).toContain('₹1,60,000.00');
    expect(screen.getByText('Pocket Wallet').parentElement?.textContent).toContain('₹5,000.00');
    // A debt carries its sign, so it is not read as money held.
    expect(screen.getAllByText('Rewards Card')[0].parentElement?.textContent).toContain('- ₹10,000.00');
  });

  it('adds up assets and liabilities separately and nets them off', async () => {
    await show();
    expect(besideLabel('Total Assets')).toContain('₹1,65,000.00');
    expect(besideLabel('Liabilities')).toContain('₹10,000.00');
    expect(besideLabel('Net Balance')).toContain('₹1,55,000.00');
  });

  it('filters to assets or to liabilities', async () => {
    await show();
    fireEvent.click(tab(/^Assets \(2\)/));
    expect(screen.getByText('Pocket Wallet')).toBeTruthy();
    expect(screen.queryByText('OWED')).toBeNull();

    fireEvent.click(tab(/^Liabilities \(1\)/));
    expect(screen.queryByText('City Bank Savings')).toBeNull();
    expect(screen.queryByText('Pocket Wallet')).toBeNull();
    expect(screen.getByText('OWED')).toBeTruthy();
  });

  it('says so when a filter matches nothing', async () => {
    accounts = [BANK, WALLET];
    await show();
    fireEvent.click(tab(/^Liabilities \(0\)/));
    expect(screen.getByText('No accounts match the selected category filter.')).toBeTruthy();
  });

  // A card is an account with both a statement day and a due day.
  it('shows a billing cycle for a credit card but not for a loan', async () => {
    accounts = [BANK, CARD, LOAN];
    await show();
    expect(screen.getByRole('heading', { name: 'Card cycles' })).toBeTruthy();
    expect(screen.getAllByText('Rewards Card')).toHaveLength(2);
    expect(screen.getAllByText('Home Loan')).toHaveLength(1);
    expect(screen.getByText('Owed on statement')).toBeTruthy();
  });
});

describe('adding and closing accounts', () => {
  it('opens the add-account form from the header button', async () => {
    await show();
    expect(screen.queryByText('Add New Account')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Add Account/ }));
    expect(screen.getByText('Add New Account')).toBeTruthy();
  });

  it('asks before deactivating an account, then deactivates it', async () => {
    await show();
    fireEvent.click(screen.getByText('Pocket Wallet'));
    expect(screen.getByText('Account Details')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Account' }));

    expect(screen.getByText(/Are you sure you want to deactivate "Pocket Wallet"\?/)).toBeTruthy();
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Account' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/accounts/acc-wallet'));
  });
});

describe('a new or unlucky visit', () => {
  it('invites someone with no accounts to add their first one', async () => {
    accounts = [];
    await show();
    expect(screen.getByText('No Accounts Found')).toBeTruthy();
    expect(screen.getByText(/Click Add Account to create your first bank or cash account/)).toBeTruthy();
    // Held back until there is an account, so it does not compete with the invitation.
    expect(screen.queryByText('Instalments')).toBeNull();

    const buttons = screen.getAllByRole('button', { name: /Add Account/ });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(screen.getByText('Add New Account')).toBeTruthy();
  });

  it('shows an error with a retry when the accounts cannot be loaded', async () => {
    accountsError = new Error('boom');
    await show();
    expect(screen.getByText('Accounts Error')).toBeTruthy();
    expect(screen.getByText('Failed to load accounts.')).toBeTruthy();

    accountsError = null;
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await settle();
    expect(screen.getByText('City Bank Savings')).toBeTruthy();
  });

  // The card ledger and instalment plans are extras; losing them must not lose the list.
  it('still lists the accounts when the card data fails to load', async () => {
    cardDataError = new Error('boom');
    await show();
    expect(screen.queryByText('Accounts Error')).toBeNull();
    expect(screen.getByText('City Bank Savings')).toBeTruthy();
  });
});
