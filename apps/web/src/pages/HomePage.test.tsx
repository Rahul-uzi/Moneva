// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './HomePage';
import { useAuthStore } from '../stores/useAuthStore';
import type {
  Account, DueIncome, FinancialSummary, RecurringIncome, Transaction, User,
} from '../types/api';

/**
 * The dashboard: the figures someone opens the app to see, and what it does
 * when there is nothing to show or the server lets it down.
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
// Reads the phone's notification queue through a native plugin.
vi.mock('../components/financial/PendingPayments', () => ({ PendingPayments: () => null }));
vi.mock('../components/financial/RecurringSalaryModal', () => ({ RecurringSalaryModal: () => null }));
vi.mock('../components/financial/SalaryConfirmationModal', () => ({ SalaryConfirmationModal: () => null }));
vi.mock('../components/financial/TransactionDetailModal', () => ({
  TransactionDetailModal: () => <div>Transaction detail stub</div>,
}));

const USER: User = {
  id: 'u', email: 'person@example.com', display_name: 'Asha Rao', currency: 'INR', timezone: 'Asia/Kolkata',
  is_active: true, email_verified: true, avatar_data_url: null, totp_enabled: false, created_at: '', updated_at: '',
};

const SUMMARY: FinancialSummary = {
  net_worth_minor: 15000000, // ₹1,50,000.00
  income_minor: 8000000, // ₹80,000.00
  expense_minor: 3000000, // ₹30,000.00
  net_cash_flow_minor: 5000000,
  currency: 'INR',
};

const ACCOUNTS: Account[] = [
  {
    id: 'acc-bank', user_id: 'u', name: 'City Bank Savings', account_type: 'asset', currency: 'INR',
    opening_balance_minor: 10000000, balance_paise: 16000000, is_active: true,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'acc-card', user_id: 'u', name: 'Rewards Card', account_type: 'liability', currency: 'INR',
    opening_balance_minor: 0, balance_paise: 1000000, is_active: true,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  },
];

/** Local noon a whole number of days from today, so the count is calendar days. */
const daysFromToday = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
};

const SALARY: RecurringIncome = {
  id: 'stream-1', user_id: 'u', source: 'Monthly Salary', amount_minor: 5000000, frequency: 'monthly',
  next_occurrence: daysFromToday(5), anchor_day: null, active: true, created_at: '', updated_at: '',
};

const TX: Transaction = {
  id: 'tx-1', user_id: 'u', account_id: 'acc-bank', category_id: null, transaction_type: 'expense',
  amount_minor: 120000, currency: 'INR', description: 'Corner grocery', notes: null,
  transaction_date: '2026-10-01T06:00:00Z', client_mutation_id: 'm-1', device_id: 'web-client',
  sync_status: 'synced', created_at: '2026-10-01T06:00:00Z', updated_at: '2026-10-01T06:00:00Z', version: 1,
};

let data: {
  summary: FinancialSummary;
  accounts: Account[];
  transactions: Transaction[];
  streams: RecurringIncome[];
  due: DueIncome[];
};
/** URLs that should fail on the next load, and how. */
let failing: Record<string, unknown>;

beforeAll(() => {
  // Reduced motion, so the net worth lands on its value at once instead of
  // counting up over the next 650ms.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce'), media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});
beforeEach(() => {
  data = { summary: SUMMARY, accounts: ACCOUNTS, transactions: [TX], streams: [SALARY], due: [] };
  failing = {};
  get.mockImplementation((url: string) => {
    if (url in failing) return Promise.reject(failing[url]);
    switch (url) {
      case '/finance/summary': return Promise.resolve({ data: data.summary });
      case '/accounts': return Promise.resolve({ data: data.accounts });
      case '/transactions': return Promise.resolve({ data: data.transactions });
      case '/income/salary-usage': return Promise.resolve({ data: null });
      case '/income/recurring/due': return Promise.resolve({ data: data.due });
      case '/income/recurring': return Promise.resolve({ data: data.streams });
      default: return Promise.resolve({ data: [] });
    }
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
  render(<MemoryRouter><HomePage /></MemoryRouter>);
  await settle();
};

/** The text beside a label, read from the block that holds both. */
const besideLabel = (label: string) => screen.getByText(label).parentElement?.textContent ?? '';

describe('the dashboard figures', () => {
  it('shows the net worth, income and expenses from the summary', async () => {
    await show();
    const card = screen.getByText('TOTAL NET WORTH').closest('[data-tour="net-worth"]');
    expect(card?.textContent).toContain('₹1,50,000.00');
    // Each figure sits beside its own label, so swapping them would fail here.
    expect(besideLabel('Income')).toContain('₹80,000.00');
    expect(besideLabel('Expenses')).toContain('₹30,000.00');
  });

  it('counts down the days to the next salary', async () => {
    await show();
    expect(besideLabel('Next payday')).toContain('5 days');
    expect(besideLabel('Next payday')).toContain('Monthly Salary');
    expect(screen.getByRole('img', { name: /Monthly Salary arrives in 5 days/ })).toBeTruthy();
  });

  // Two answers to "where is my salary" would contradict each other.
  it('does not count down while a salary is overdue and unrecorded', async () => {
    data.due = [{
      id: 'stream-1', source: 'Monthly Salary', frequency: 'monthly', due_on: daysFromToday(-2),
      expected_amount_minor: 5000000, missed_count: 1,
    }];
    await show();
    expect(screen.queryByText('Next payday')).toBeNull();
  });

  it('lists each account with its balance, and marks a card balance as owed', async () => {
    await show();
    expect(besideLabel('My Accounts')).toContain('2 Total');
    expect(screen.getByText('City Bank Savings').parentElement?.textContent).toContain('₹1,60,000.00');
    const card = screen.getByText('Rewards Card').parentElement?.textContent ?? '';
    expect(card).toContain('- ₹10,000.00');
    expect(screen.getByText('OWED')).toBeTruthy();
  });

  it('shows the latest transactions with a way to see them all', async () => {
    await show();
    expect(screen.getByText('Corner grocery')).toBeTruthy();
    expect(screen.getByRole('button', { name: /See all/ })).toBeTruthy();
  });
});

describe('when there is nothing yet', () => {
  it('invites a new person to create an account', async () => {
    data = { ...data, accounts: [], transactions: [], streams: [] };
    await show();
    expect(screen.getByText('No Accounts')).toBeTruthy();
    expect(screen.getByText('Create an account to begin tracking transactions.')).toBeTruthy();
    expect(screen.getByText('No Recent Activity')).toBeTruthy();
    expect(screen.queryByText('Next payday')).toBeNull();
  });
});

describe('when the server lets it down', () => {
  it('says the dashboard could not load instead of crashing, and recovers on retry', async () => {
    failing['/finance/summary'] = new Error('boom');
    await show();
    expect(screen.getByText('Dashboard Error')).toBeTruthy();
    expect(screen.getByText('Failed to load financial dashboard.')).toBeTruthy();

    delete failing['/finance/summary'];
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await settle();
    expect(screen.queryByText('Dashboard Error')).toBeNull();
    expect(screen.getByText('TOTAL NET WORTH')).toBeTruthy();
  });

  // The salary figures are optional: losing them must not cost the dashboard.
  it('still shows the dashboard when only the salary requests fail', async () => {
    failing['/income/salary-usage'] = new Error('boom');
    failing['/income/recurring'] = new Error('boom');
    failing['/income/recurring/due'] = new Error('boom');
    await show();
    expect(screen.queryByText('Dashboard Error')).toBeNull();
    expect(screen.getByText('City Bank Savings')).toBeTruthy();
    expect(screen.queryByText('Next payday')).toBeNull();
  });
});
