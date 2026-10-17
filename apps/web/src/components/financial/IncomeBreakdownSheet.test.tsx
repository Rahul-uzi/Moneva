// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { IncomeBreakdownSheet } from './IncomeBreakdownSheet';
import { SalaryUsageCard } from './SalaryUsageCard';
import { isSalaryIncome } from '../../utils/incomeSplit';
import type { SalaryUsage, Transaction } from '../../types/api';

const get = vi.fn();
vi.mock('../../services/apiClient', () => ({
  apiClient: { get: (...a: unknown[]) => get(...a) },
}));

const USAGE: SalaryUsage = {
  period_start: '2026-03-01T00:00:00Z', period_end: '2026-04-01T00:00:00Z',
  salary_received_minor: 4000000, other_income_minor: 120000, total_income_minor: 4120000,
  spent_minor: 1000000, remaining_minor: 3120000, used_percent: 24.3,
  has_salary_configured: true, currency: 'INR',
};

const tx = (id: string, amount: number, description: string, date: string): Transaction => ({
  id, user_id: 'u', account_id: 'acc', to_account_id: null, category_id: null, transaction_type: 'income',
  amount_minor: amount, currency: 'INR', description, notes: null, transaction_date: date,
  created_at: date, updated_at: date, version: 1,
} as unknown as Transaction);

const ROWS = [
  tx('t1', 4000000, 'Salary Received: Office Pay', '2026-03-09T10:00:00Z'),
  tx('t2', 100000, 'Google Pay - Friend One', '2026-03-12T10:00:00Z'),
  tx('t3', 20000, 'Cashback reward', '2026-03-03T10:00:00Z'),
  // The 1st of the next month is not this month, even if the server sends it.
  tx('t4', 999900, 'Google Pay - Too Late', '2026-04-01T00:00:00Z'),
];

beforeEach(() => { get.mockResolvedValue({ data: ROWS }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('salary or extra income', () => {
  it('is salary when it names a salary source, or says salary', () => {
    expect(isSalaryIncome('Office Pay for March', ['Office Pay'])).toBe(true);
    expect(isSalaryIncome('SALARY credit', [])).toBe(true);
    expect(isSalaryIncome('Google Pay - Friend One', ['Office Pay'])).toBe(false);
    expect(isSalaryIncome(null, ['Office Pay'])).toBe(false);
    // A blank source must not match everything.
    expect(isSalaryIncome('Google Pay - Friend One', ['  '])).toBe(false);
  });
});

describe('the month card', () => {
  // Asked for by the user: it is all income, so not "Other".
  it('calls the rest extra income, never "Other"', () => {
    render(<SalaryUsageCard usage={USAGE} onShowIncome={() => {}} />);
    expect(screen.getByRole('button', { name: 'Salary ₹40,000 Extra income ₹1,200' })).toBeTruthy();
    expect(screen.queryByText(/Other/)).toBeNull();
  });

  // Each part moves down whole when the line runs out, never mid-way.
  it('keeps each label with its amount', () => {
    render(<SalaryUsageCard usage={USAGE} onShowIncome={() => {}} />);
    expect(screen.getByText('Salary ₹40,000').className).toBe('salary-part');
    expect(screen.getByText('Extra income ₹1,200').className).toBe('salary-part');
  });

  it('keeps the paise when there are some', () => {
    render(<SalaryUsageCard usage={{ ...USAGE, other_income_minor: 120050, total_income_minor: 4120050 }} onShowIncome={() => {}} />);
    expect(screen.getByText('Extra income ₹1,200.50')).toBeTruthy();
  });

  it('opens the payments from that line', () => {
    const onShowIncome = vi.fn();
    render(<SalaryUsageCard usage={USAGE} onShowIncome={onShowIncome} />);
    fireEvent.click(screen.getByRole('button', { name: /Extra income/ }));
    expect(onShowIncome).toHaveBeenCalledTimes(1);
  });

  it('still shows the split, untappable, with nothing to open it', () => {
    render(<SalaryUsageCard usage={USAGE} />);
    expect(screen.getByText('Extra income ₹1,200')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Extra income/ })).toBeNull();
  });

  it('shows salary alone when there is nothing extra', () => {
    render(<SalaryUsageCard usage={{ ...USAGE, other_income_minor: 0, total_income_minor: 4000000 }} onShowIncome={() => {}} />);
    expect(screen.getByRole('button', { name: 'Salary ₹40,000' })).toBeTruthy();
  });
});

describe('the month\'s income sheet', () => {
  const open = (onSelect = vi.fn()) =>
    render(<IncomeBreakdownSheet isOpen onClose={() => {}} usage={USAGE} salarySources={['Office Pay']} onSelect={onSelect} />);

  it('asks for this month\'s income only', async () => {
    open();
    await settle();
    expect(get).toHaveBeenCalledWith('/transactions', {
      params: { transaction_type: 'income', start_date: USAGE.period_start, end_date: USAGE.period_end },
    });
  });

  it('lists salary and extra income apart, each with its total, adding up to what was received', async () => {
    open();
    await settle();
    const salary = screen.getByRole('region', { name: 'Salary' });
    const extra = screen.getByRole('region', { name: 'Extra income' });
    expect(within(salary).getByText('Salary Received: Office Pay')).toBeTruthy();
    expect(within(salary).getByText('₹40,000.00', { selector: '.ib-section-total' })).toBeTruthy();
    expect(within(extra).getByText('Google Pay - Friend One')).toBeTruthy();
    expect(within(extra).getByText('Cashback reward')).toBeTruthy();
    expect(within(extra).getByText('₹1,200.00', { selector: '.ib-section-total' })).toBeTruthy();
    expect(screen.queryByText('Google Pay - Too Late')).toBeNull();
    expect(screen.getByText('Received').parentElement?.textContent).toContain('₹41,200.00');
  });

  it('opens a payment when it is tapped', async () => {
    const onSelect = vi.fn();
    open(onSelect);
    await settle();
    fireEvent.click(screen.getByText('Cashback reward'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't3' }));
  });

  it('says so when the list cannot load', async () => {
    get.mockRejectedValue(new Error('offline'));
    open();
    await settle();
    expect(screen.getByText(/Could not load this month's income/)).toBeTruthy();
  });
});
