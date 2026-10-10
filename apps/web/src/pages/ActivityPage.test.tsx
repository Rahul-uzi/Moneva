// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ActivityPage } from './ActivityPage';
import type { Account, Category, Transaction } from '../types/api';

/**
 * The Activity log: every entry, grouped by day, narrowed by type, search
 * and period, and opened for a look, an edit or a delete.
 */

const get = vi.fn();
const del = vi.fn();
vi.mock('../services/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/apiClient')>()),
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    patch: vi.fn(),
    delete: (...a: unknown[]) => del(...a),
  },
}));
const revokeTrust = vi.fn();
vi.mock('../services/autoAddStore', () => ({
  revokeTrustForDeletedRow: (...a: unknown[]) => revokeTrust(...a),
}));
// The two sheets have their own behaviour; here it only matters which entry
// the page hands them.
vi.mock('../components/financial/TransactionDetailModal', () => ({
  TransactionDetailModal: ({ transaction, accountName, categoryName }: {
    transaction: Transaction | null; accountName?: string; categoryName?: string;
  }) => (
    <div role="dialog" aria-label="Transaction detail">
      {`${transaction?.description} | ${accountName} | ${categoryName ?? 'no category'}`}
    </div>
  ),
}));
vi.mock('../components/financial/TransactionEditModal', () => ({
  TransactionEditModal: ({ transaction, focusNotes }: { transaction: Transaction | null; focusNotes?: boolean }) =>
    transaction ? (
      <div role="dialog" aria-label="Edit transaction">
        {`Editing ${transaction.description}${focusNotes ? ' (note first)' : ''}`}
      </div>
    ) : null,
}));

const DAY = 86_400_000;
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

const ACCOUNTS: Account[] = [
  { id: 'acc-bank', user_id: 'u', name: 'City Bank Savings', account_type: 'asset', currency: 'INR', opening_balance_minor: 0, is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  { id: 'acc-cash', user_id: 'u', name: 'Cash Wallet', account_type: 'asset', currency: 'INR', opening_balance_minor: 0, is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
];
const CATEGORIES: Category[] = [
  { id: 'cat-groc', name: 'Groceries', type: 'expense', is_default: true, created_at: '2026-01-01', updated_at: '' },
  { id: 'cat-util', name: 'Utilities', type: 'expense', is_default: true, created_at: '2026-01-01', updated_at: '' },
  { id: 'cat-sal', name: 'Salary', type: 'income', is_default: true, created_at: '2026-01-01', updated_at: '' },
];

const tx = (over: Partial<Transaction> & Pick<Transaction, 'id' | 'transaction_type' | 'amount_minor' | 'transaction_date'>): Transaction => ({
  user_id: 'u', account_id: 'acc-bank', category_id: null, currency: 'INR', description: null, notes: null,
  client_mutation_id: `m-${over.id}`, device_id: 'test-device', sync_status: 'synced',
  created_at: over.transaction_date, updated_at: over.transaction_date, version: 1,
  ...over,
});

const FORTY_DAYS_AGO = NOW - 40 * DAY;
// Newest first, the order the API sends them in.
const TRANSACTIONS: Transaction[] = [
  tx({ id: 'tx-1', transaction_type: 'expense', amount_minor: 120000, description: 'Fresh Mart', category_id: 'cat-groc', transaction_date: iso(NOW) }),
  tx({ id: 'tx-2', transaction_type: 'income', amount_minor: 5000000, description: 'Monthly Salary', category_id: 'cat-sal', transaction_date: iso(NOW - 1000) }),
  tx({ id: 'tx-3', transaction_type: 'expense', amount_minor: 180000, description: 'Power Board', category_id: 'cat-util', transaction_date: iso(NOW - DAY) }),
  tx({ id: 'tx-4', transaction_type: 'expense', amount_minor: 50000, description: 'Corner Book Store', account_id: 'acc-cash', transaction_date: iso(FORTY_DAYS_AGO) }),
];

let transactions: Transaction[] = [];
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});
beforeEach(() => {
  transactions = TRANSACTIONS;
  get.mockImplementation((url: string) => {
    if (url === '/transactions') return Promise.resolve({ data: transactions });
    if (url === '/accounts') return Promise.resolve({ data: ACCOUNTS });
    if (url === '/categories') return Promise.resolve({ data: CATEGORIES });
    return Promise.resolve({ data: [] });
  });
  del.mockResolvedValue({ data: {} });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const show = async () => {
  render(<MemoryRouter><ActivityPage /></MemoryRouter>);
  await settle();
};

/** Entry titles in the order they appear on screen. */
const titles = () => Array.from(document.querySelectorAll('.tx-title')).map((el) => el.textContent);
/** The figure printed under a summary label such as "Total Income". */
const metric = (label: string) => screen.getByText(label).parentElement?.textContent?.replace(label, '');
const search = (text: string) => fireEvent.change(screen.getByPlaceholderText('Search transactions'), { target: { value: text } });

describe('the activity list', () => {
  it('lists every entry under its day, in the order they came, with each day\'s net', async () => {
    await show();
    expect(titles()).toEqual(['Fresh Mart', 'Monthly Salary', 'Power Board', 'Corner Book Store']);

    const older = new Date(FORTY_DAYS_AGO).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const headers = Array.from(document.querySelectorAll('.date-group-header')).map((el) => el.textContent);
    // Today: 50,000 in, 1,200 out.
    expect(headers).toEqual(['Today+₹48,800.00', 'Yesterday-₹1,800.00', `${older}-₹500.00`]);
  });

  // The page grouped in whatever order the API sent; oldest-first would have
  // put last month at the top.
  it('puts the newest day first even when the server sends oldest first', async () => {
    transactions = [...TRANSACTIONS].reverse();
    await show();
    expect(titles()).toEqual(['Fresh Mart', 'Monthly Salary', 'Power Board', 'Corner Book Store']);
  });

  it('totals the money in and out of what is listed', async () => {
    await show();
    expect(metric('Total Income')).toBe('₹50,000.00');
    expect(metric('Total Expenses')).toBe('₹3,500.00');
  });

  it('shows only expenses, or only income, from the tabs', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }));
    expect(titles()).toEqual(['Fresh Mart', 'Power Board', 'Corner Book Store']);
    expect(metric('Total Income')).toBe('₹0.00');

    fireEvent.click(screen.getByRole('button', { name: 'Income' }));
    expect(titles()).toEqual(['Monthly Salary']);
    expect(metric('Total Expenses')).toBe('₹0.00');

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(titles()).toHaveLength(4);
  });

  it('finds entries by description, category or account name', async () => {
    await show();
    search('power');
    expect(titles()).toEqual(['Power Board']);
    // "Groceries" is only the category, never written on the row itself.
    search('groceries');
    expect(titles()).toEqual(['Fresh Mart']);
    search('cash wallet');
    expect(titles()).toEqual(['Corner Book Store']);
  });

  it('says nothing matches rather than showing an empty list', async () => {
    await show();
    search('holiday cruise');
    expect(screen.getByText('No Transactions Found')).toBeTruthy();
    expect(screen.getByText('No transactions match your selected search or filter.')).toBeTruthy();
  });

  it('drops older entries when a shorter period is picked', async () => {
    await show();
    fireEvent.change(screen.getByLabelText('Time period'), { target: { value: '30d' } });
    expect(titles()).not.toContain('Corner Book Store');
    expect(metric('Total Expenses')).toBe('₹3,000.00');

    fireEvent.change(screen.getByLabelText('Time period'), { target: { value: 'all' } });
    expect(titles()).toContain('Corner Book Store');
  });

  it('invites a first entry when there is no activity at all', async () => {
    transactions = [];
    await show();
    expect(screen.getByText('No Transactions Found')).toBeTruthy();
    expect(screen.getByText('You have not created any transaction activity yet.')).toBeTruthy();
  });

  it('shows an error with a retry, not a crash, when the log cannot load', async () => {
    get.mockImplementation(() => Promise.reject(new Error('offline')));
    await show();
    expect(screen.getByText('Activity Error')).toBeTruthy();
    expect(screen.getByText('Failed to load activity log.')).toBeTruthy();

    get.mockImplementation((url: string) => {
      if (url === '/transactions') return Promise.resolve({ data: TRANSACTIONS });
      return Promise.resolve({ data: url === '/accounts' ? ACCOUNTS : CATEGORIES });
    });
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await settle();
    expect(titles()).toHaveLength(4);
  });
});

describe('opening an entry', () => {
  it('opens the details with its account and category named', async () => {
    await show();
    fireEvent.click(screen.getByText('Power Board'));
    expect(screen.getByRole('dialog', { name: 'Transaction detail' }).textContent)
      .toBe('Power Board | City Bank Savings | Utilities');
  });

  it('offers edit, note and delete on a long press, and edit opens that entry', async () => {
    await show();
    fireEvent.contextMenu(screen.getByText('Fresh Mart'));
    const sheet = screen.getByRole('dialog', { name: 'Transaction actions' });
    expect(within(sheet).getByText('₹1,200.00')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Add a note' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Delete' })).toBeTruthy();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('dialog', { name: 'Transaction actions' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Edit transaction' }).textContent).toBe('Editing Fresh Mart');
    // A long press is not also a tap: the detail view stays shut.
    expect(screen.queryByRole('dialog', { name: 'Transaction detail' })).toBeNull();
  });

  // Asking for a note and landing on the amount would make the person hunt for it.
  it('opens the editor on the note when a note is asked for', async () => {
    await show();
    fireEvent.contextMenu(screen.getByText('Fresh Mart'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Transaction actions' })).getByRole('button', { name: 'Add a note' }));
    expect(screen.getByRole('dialog', { name: 'Edit transaction' }).textContent).toBe('Editing Fresh Mart (note first)');
  });

  it('deletes an entry only after confirming, then reloads the list', async () => {
    await show();
    fireEvent.contextMenu(screen.getByText('Power Board'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Transaction actions' })).getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this entry?')).toBeTruthy();
    expect(screen.getByText(/₹1,800.00 will be removed/)).toBeTruthy();
    expect(del).not.toHaveBeenCalled();

    const loadsBefore = get.mock.calls.filter((c) => c[0] === '/transactions').length;
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/transactions/tx-3'));
    await settle();
    expect((revokeTrust.mock.calls[0] as [Transaction])[0].id).toBe('tx-3');
    expect(get.mock.calls.filter((c) => c[0] === '/transactions').length).toBe(loadsBefore + 1);
    expect(screen.queryByText('Delete this entry?')).toBeNull();
  });
});
