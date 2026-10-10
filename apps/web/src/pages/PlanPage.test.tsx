// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PlanPage } from './PlanPage';
import type { Account, Bill, Budget, Category, SavingsGoal, Transaction } from '../types/api';

/**
 * The Plan screen: budgets against what was spent, goals against their
 * targets, bills coming up, and the payments that repeat on their own.
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
// The forms and detail sheets are tested on their own; here it only matters
// that the page opens the right one for the right item.
vi.mock('../components/financial/BudgetModal', () => ({
  BudgetModal: ({ isOpen, budgetToEdit }: { isOpen: boolean; budgetToEdit: Budget | null }) =>
    isOpen ? <div role="dialog" aria-label="Budget form">{budgetToEdit ? `Editing budget ${budgetToEdit.id}` : 'New budget'}</div> : null,
}));
vi.mock('../components/financial/BudgetDetailModal', () => ({
  BudgetDetailModal: ({ budget }: { budget: Budget | null }) =>
    budget ? <div role="dialog" aria-label="Budget detail">{budget.id}</div> : null,
}));
vi.mock('../components/financial/GoalModal', () => ({
  GoalModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div role="dialog" aria-label="Goal form" /> : null),
}));
vi.mock('../components/financial/GoalDetailModal', () => ({
  GoalDetailModal: ({ goal }: { goal: SavingsGoal | null }) =>
    goal ? <div role="dialog" aria-label="Goal detail">{goal.name}</div> : null,
}));
vi.mock('../components/financial/GoalContributionModal', () => ({
  GoalContributionModal: ({ goal }: { goal: SavingsGoal | null }) =>
    goal ? <div role="dialog" aria-label="Add to goal">{`Adding to ${goal.name}`}</div> : null,
}));
vi.mock('../components/financial/BillModal', () => ({
  BillModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div role="dialog" aria-label="Bill form" /> : null),
}));
vi.mock('../components/financial/BillDetailModal', () => ({
  BillDetailModal: ({ bill }: { bill: Bill | null }) =>
    bill ? <div role="dialog" aria-label="Bill detail">{bill.name}</div> : null,
}));
vi.mock('../components/financial/BillPayModal', () => ({
  BillPayModal: ({ bill }: { bill: Bill | null }) =>
    bill ? <div role="dialog" aria-label="Pay bill">{`Paying ${bill.name}`}</div> : null,
}));

const DAY = 86_400_000;
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const STAMP = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };

const CATEGORIES: Category[] = [
  { id: 'cat-groc', name: 'Groceries', type: 'expense', is_default: true, ...STAMP },
  { id: 'cat-dine', name: 'Dining Out', type: 'expense', is_default: true, ...STAMP },
];
const ACCOUNTS: Account[] = [
  { id: 'acc-bank', user_id: 'u', name: 'City Bank Savings', account_type: 'asset', currency: 'INR', opening_balance_minor: 0, is_active: true, ...STAMP },
];
const monthBounds = { period: 'monthly', start_date: iso(NOW - 10 * DAY), end_date: iso(NOW + 20 * DAY) };
const BUDGETS: Budget[] = [
  { id: 'bud-groc', user_id: 'u', category_id: 'cat-groc', limit_amount_minor: 1000000, spent_amount_minor: 400000, ...monthBounds, ...STAMP },
  { id: 'bud-dine', user_id: 'u', category_id: 'cat-dine', limit_amount_minor: 300000, spent_amount_minor: 360000, ...monthBounds, ...STAMP },
];
const GOALS: SavingsGoal[] = [
  { id: 'goal-1', user_id: 'u', name: 'Emergency Fund', target_amount_minor: 10000000, current_saved_minor: 2500000, target_date: null, status: 'active', ...STAMP },
];
const bill = (over: Partial<Bill> & Pick<Bill, 'id' | 'name' | 'amount_minor' | 'due_date'>): Bill => ({
  user_id: 'u', currency: 'INR', recurrence: 'monthly', category_id: null, status: 'upcoming', reminder_enabled: true, ...STAMP, ...over,
});
const BILLS: Bill[] = [
  bill({ id: 'bill-net', name: 'Internet Plan', amount_minor: 99900, due_date: iso(NOW + 2 * DAY) }),
  bill({ id: 'bill-rent', name: 'House Rent', amount_minor: 1500000, due_date: iso(NOW + 20 * DAY) }),
  bill({ id: 'bill-water', name: 'Water Supply', amount_minor: 40000, due_date: iso(NOW - 5 * DAY), status: 'paid' }),
];

const expense = (id: string, description: string, amount_minor: number, at: number): Transaction => ({
  id, user_id: 'u', account_id: 'acc-bank', category_id: null, transaction_type: 'expense', amount_minor,
  currency: 'INR', description, notes: null, transaction_date: iso(at), client_mutation_id: `m-${id}`,
  device_id: 'test-device', sync_status: 'synced', created_at: iso(at), updated_at: iso(at), version: 1,
});
// Four payments to one payee, thirty days apart: a monthly subscription.
// Two visits to a cafe are not one.
const HISTORY: Transaction[] = [
  expense('s1', 'Stream Box', 49900, NOW - 5 * DAY),
  expense('s2', 'Stream Box', 49900, NOW - 35 * DAY),
  expense('s3', 'Stream Box', 49900, NOW - 65 * DAY),
  expense('s4', 'Stream Box', 49900, NOW - 95 * DAY),
  expense('c1', 'Corner Cafe', 25000, NOW - 3 * DAY),
  expense('c2', 'Corner Cafe', 31000, NOW - 33 * DAY),
];

let data: { budgets: Budget[]; goals: SavingsGoal[]; bills: Bill[]; history: Transaction[] };
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});
beforeEach(() => {
  data = { budgets: BUDGETS, goals: GOALS, bills: BILLS, history: HISTORY };
  get.mockImplementation((url: string) => {
    if (url === '/budgets') return Promise.resolve({ data: data.budgets });
    if (url === '/goals') return Promise.resolve({ data: data.goals });
    if (url === '/bills') return Promise.resolve({ data: data.bills });
    if (url === '/categories') return Promise.resolve({ data: CATEGORIES });
    if (url === '/accounts') return Promise.resolve({ data: ACCOUNTS });
    if (url === '/transactions') return Promise.resolve({ data: data.history });
    return Promise.resolve({ data: [] });
  });
  del.mockResolvedValue({ data: {} });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const show = async () => {
  render(<MemoryRouter><PlanPage /></MemoryRouter>);
  await settle();
};
const card = (name: string) => screen.getByText(name).closest('.plan-card-wrapper') as HTMLElement;
const heading = (name: string) => screen.queryByRole('heading', { name });

describe('budgets', () => {
  it('shows what each budget has spent against its limit', async () => {
    await show();
    const groceries = card('Groceries');
    expect(within(groceries).getByText('₹4,000.00')).toBeTruthy();
    expect(within(groceries).getByText('Remaining: ₹6,000.00')).toBeTruthy();
    expect(within(groceries).getByText('40%')).toBeTruthy();
    expect(within(groceries).getByText('Healthy')).toBeTruthy();

    const dining = card('Dining Out');
    expect(within(dining).getByText('Over Budget')).toBeTruthy();
    expect(within(dining).getByText('Over by ₹600.00')).toBeTruthy();
  });

  it('adds every budget into one spent-of-limit total', async () => {
    await show();
    expect(screen.getByText('₹7,600')).toBeTruthy();
    expect(screen.getByText('of ₹13,000')).toBeTruthy();
  });

  it('opens the right budget for editing, and deletes only after confirming', async () => {
    await show();
    fireEvent.click(within(card('Groceries')).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('dialog', { name: 'Budget form' }).textContent).toBe('Editing budget bud-groc');

    fireEvent.click(within(card('Groceries')).getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Are you sure you want to delete "Budget (Groceries)"?')).toBeTruthy();
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByText('Delete Item').closest('.modal-container') as HTMLElement)
      .getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/budgets/bud-groc'));
  });
});

describe('what needs attention', () => {
  it('leads with the overspent budget and keeps the rest one tap away', async () => {
    await show();
    expect(screen.getByRole('button', { name: /^Dining Out over by ₹600/ })).toBeTruthy();
    // The bill due in two days is counted, not hidden.
    expect(screen.queryByText('Internet Plan due in 2d')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+1 more reminder' }));
    expect(screen.getByText('Internet Plan due in 2d')).toBeTruthy();
    // Rent is three weeks off - not yet a reminder.
    expect(screen.queryByText(/House Rent due/)).toBeNull();
  });

  it('opens the bill from its reminder', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: '+1 more reminder' }));
    fireEvent.click(screen.getByRole('button', { name: /^Internet Plan due in 2d/ }));
    expect(screen.getByRole('dialog', { name: 'Bill detail' }).textContent).toBe('Internet Plan');
  });

  it('jumps to the budgets when the overspend is tapped', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: /^Dining Out over by ₹600/ }));
    expect(heading('Budgets')).toBeTruthy();
    expect(heading('Savings Goals')).toBeNull();
    expect(heading('Bills')).toBeNull();
  });

  it('reports goal progress when nothing is wrong', async () => {
    data.budgets = [BUDGETS[0]];
    data.bills = [];
    await show();
    expect(screen.getByRole('button', { name: /^25% of the way to your goals/ })).toBeTruthy();
  });
});

describe('goals and bills', () => {
  it('shows each goal saved against its target, and opens a contribution', async () => {
    await show();
    const fund = card('Emergency Fund');
    expect(within(fund).getByText('₹25,000.00')).toBeTruthy();
    expect(within(fund).getByText('₹1,00,000.00')).toBeTruthy();
    expect(within(fund).getByText('25%')).toBeTruthy();

    fireEvent.click(within(fund).getByRole('button', { name: 'Contribute' }));
    expect(screen.getByRole('dialog', { name: 'Add to goal' }).textContent).toBe('Adding to Emergency Fund');
  });

  // A paid bill is no longer owed, so it must not swell the total.
  it('counts only unpaid bills in what is due', async () => {
    await show();
    expect(screen.getByText('₹15,999')).toBeTruthy();
    expect(screen.getByText('2 upcoming')).toBeTruthy();
    expect(screen.getByText('3 Tracked')).toBeTruthy();
    expect(within(card('Water Supply')).getAllByText('Paid').length).toBeGreaterThan(0);
  });

  it('opens payment for a bill from its card', async () => {
    await show();
    fireEvent.click(within(card('House Rent')).getByRole('button', { name: 'Pay Now' }));
    expect(screen.getByRole('dialog', { name: 'Pay bill' }).textContent).toBe('Paying House Rent');
  });
});

describe('repeating payments', () => {
  it('finds a monthly payment in the history and prices it over a year', async () => {
    await show();
    expect(heading('Repeating payments')).toBeTruthy();
    expect(screen.getByText('₹5,988.00 a year')).toBeTruthy();
    const row = screen.getByText('Stream Box').closest('.subs-row') as HTMLElement;
    expect(row.textContent).toContain('Every month · 4 payments · due in 25 days');
    expect(within(row).getByText('₹499.00')).toBeTruthy();
    // Two visits to a cafe are a habit, not a subscription.
    expect(screen.queryByText('Corner Cafe')).toBeNull();
  });

  it('stays out of the way when nothing repeats', async () => {
    data.history = HISTORY.filter((t) => t.description === 'Corner Cafe');
    await show();
    expect(heading('Repeating payments')).toBeNull();
  });

  // Grouped with bills - both are recurring obligations - not with budgets.
  it('is filed under Bills, not Budgets or Goals', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Budgets' }));
    expect(heading('Repeating payments')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Goals' }));
    expect(heading('Repeating payments')).toBeNull();
    expect(heading('Savings Goals')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bills' }));
    expect(heading('Repeating payments')).toBeTruthy();
    expect(heading('Bills')).toBeTruthy();
    expect(heading('Budgets')).toBeNull();
  });
});

describe('an empty plan', () => {
  it('offers one invitation instead of three empty sections', async () => {
    data = { budgets: [], goals: [], bills: [], history: [] };
    await show();
    expect(heading('Nothing planned yet')).toBeTruthy();
    expect(heading('Budgets')).toBeNull();
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Budget\s*Cap a category/ }));
    expect(screen.getByRole('dialog', { name: 'Budget form' }).textContent).toBe('New budget');
  });

  it('shows an error with a retry, not a crash, when the plan cannot load', async () => {
    get.mockImplementation(() => Promise.reject(new Error('offline')));
    await show();
    expect(screen.getByText('Plan Error')).toBeTruthy();
    expect(screen.getByText('Failed to load financial plan.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy();
  });
});
