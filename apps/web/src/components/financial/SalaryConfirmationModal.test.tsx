// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SalaryConfirmationModal } from './SalaryConfirmationModal';
import type { Account, Category, RecurringIncome } from '../../types/api';

/**
 * Recording a salary that arrived - and what that does to next month.
 */

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
  },
}));

const ACCOUNTS: Account[] = [
  { id: 'bank', user_id: 'u', name: 'City Bank Savings', account_type: 'asset', currency: 'INR', opening_balance_minor: 0, is_active: true, created_at: '', updated_at: '' },
];
const CATEGORIES: Category[] = [
  { id: 'c-other', name: 'Other Income', type: 'income', is_default: true, created_at: '', updated_at: '' },
  { id: 'c-salary', name: 'Salary', type: 'income', is_default: true, created_at: '', updated_at: '' },
  { id: 'c-food', name: 'Food & Dining', type: 'expense', is_default: true, created_at: '', updated_at: '' },
];

const STREAM: RecurringIncome = {
  id: 'stream-1', user_id: 'u', source: 'Monthly Salary', amount_minor: 3150000,
  frequency: 'monthly', next_occurrence: '2026-10-10T03:30:00Z', anchor_day: 10,
  active: true, created_at: '', updated_at: '',
};

let streams: RecurringIncome[] = [];
beforeEach(() => {
  streams = [];
  get.mockImplementation(() => Promise.resolve({ data: streams }));
  post.mockResolvedValue({ data: { id: 'tx', amount_minor: 3150000, description: 'Salary' } });
  patch.mockResolvedValue({ data: {} });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const openSheet = async (accounts = ACCOUNTS) => {
  render(
    <MemoryRouter>
      <SalaryConfirmationModal isOpen accounts={accounts} categories={CATEGORIES} onClose={() => {}} onSuccess={() => {}} />
    </MemoryRouter>,
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
};

/** Types an amount on the sheet's own number pad, key by key. */
const tap = (value: string) => {
  for (const ch of value) {
    fireEvent.click(screen.getByRole('button', { name: ch === '.' ? 'Decimal point' : ch }));
  }
};

const nameIt = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: /^From:/ }));
  fireEvent.change(screen.getByLabelText('From'), { target: { value: name } });
};

describe('Add salary', () => {
  it('files it under Salary, not whichever income category comes first', async () => {
    await openSheet();
    tap('31500');
    fireEvent.click(screen.getByRole('button', { name: /Save salary/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect((post.mock.calls[0] as [string, { category_id: string }])[1].category_id).toBe('c-salary');
  });

  // Seen on screen: with Cash listed first, the salary defaulted to Cash.
  it('pays into the bank by default, even with cash listed first', async () => {
    await openSheet([{ ...ACCOUNTS[0], id: 'cash', name: 'Cash' }, ...ACCOUNTS]);
    expect(screen.getByRole('button', { name: /^To: City Bank Savings/ })).toBeTruthy();
    tap('31500');
    fireEvent.click(screen.getByRole('button', { name: /Save salary/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect((post.mock.calls[0] as [string, { account_id: string }])[1].account_id).toBe('bank');
  });

  it('fills itself in from a saved salary in one tap', async () => {
    streams = [STREAM];
    await openSheet();
    fireEvent.click(await screen.findByRole('button', { name: /₹31,500 Monthly Salary/ }));
    expect(screen.getByRole('button', { name: /^From: Monthly Salary/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Save salary · ₹31,500\.00/ })).toBeTruthy();
  });

  // The drift fix: an early salary must not pull next month's payday earlier.
  it('moves an existing salary on from the day it was due', async () => {
    streams = [STREAM];
    await openSheet();
    tap('31500');
    // Paid a day EARLY - the case that drifted. Counted from arrival, payday
    // would move to 9 Nov; counted from when it was due, it stays on the 10th.
    fireEvent.click(screen.getByRole('button', { name: /^Now/ }));
    fireEvent.change(screen.getByLabelText('Date and time received'), {
      target: { value: '2026-10-09T11:00' },
    });
    // A blank source matches the stream saved under the old default name.
    expect(await screen.findByText(/^Next payday moves to 10 Nov$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Save salary/ }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    const [url, body] = patch.mock.calls[0] as [string, { next_occurrence: string }];
    expect(url).toBe('/income/recurring/stream-1');
    expect(new Date(body.next_occurrence).getDate()).toBe(10);
  });

  it('does not skip a payday for money that comes weeks early', async () => {
    const due = new Date();
    due.setDate(due.getDate() + 30);
    streams = [{ ...STREAM, next_occurrence: due.toISOString() }];
    await openSheet();
    tap('5000');
    expect(await screen.findByText(/Monthly Salary is still due .* — this one is extra/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Save salary/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(patch).not.toHaveBeenCalled();
  });

  it('starts a monthly schedule by default, with its day of the month', async () => {
    await openSheet();
    tap('31500');
    nameIt('New Employer');
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Save salary/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const [url, body] = post.mock.calls[1] as [string, Record<string, unknown>];
    expect(url).toBe('/income/recurring');
    expect(body).toMatchObject({ source: 'New Employer', frequency: 'monthly', amount_minor: 3150000 });
    expect(typeof body.anchor_day).toBe('number');
  });

  it('records a one-off and schedules nothing when switched off', async () => {
    await openSheet();
    tap('5000');
    nameIt('Bonus');
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByText(/Just this once — no reminder/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Save salary/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe('/transactions');
    expect(patch).not.toHaveBeenCalled();
  });

  // Seen on a real phone: for the seconds the schedules took to load, the
  // sheet believed there were none, and Save would have created a second
  // "Monthly Salary" beside the real one.
  describe('before the salary schedules have loaded', () => {
    const due = new Date();
    due.setDate(due.getDate() + 30);
    const realStream = { ...STREAM, next_occurrence: due.toISOString() };

    it('says it is checking, and offers no switch', async () => {
      get.mockImplementation(() => new Promise(() => {})); // never answers
      await openSheet();
      expect(screen.getByText('Checking your salary schedule…')).toBeTruthy();
      expect(screen.queryByRole('switch')).toBeNull();
    });

    it('waits for the real list before deciding, so nothing is duplicated', async () => {
      let calls = 0;
      get.mockImplementation(() => {
        calls += 1;
        // The opening fetch hangs; the one made at Save answers.
        return calls === 1 ? new Promise(() => {}) : Promise.resolve({ data: [realStream] });
      });
      await openSheet();
      tap('5000');
      fireEvent.click(screen.getByRole('button', { name: /Save salary/ }));

      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
      expect(post.mock.calls[0][0]).toBe('/transactions');
      // The real schedule was found, so no second one was created...
      expect(post.mock.calls.some((c) => c[0] === '/income/recurring')).toBe(false);
      // ...and money 30 days early does not move it either.
      expect(patch).not.toHaveBeenCalled();
    });

    it('leaves every schedule alone when the list cannot be read', async () => {
      get.mockImplementation(() => Promise.reject(new Error('offline')));
      await openSheet();
      tap('31500');
      fireEvent.click(screen.getByRole('button', { name: /Save salary/ }));

      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
      expect(post.mock.calls[0][0]).toBe('/transactions');
      expect(patch).not.toHaveBeenCalled();
    });
  });

  it('says when the next one is due once it is saved', async () => {
    await openSheet();
    tap('31500');
    fireEvent.click(screen.getByRole('button', { name: /Save salary/ }));
    expect(await screen.findByText(/Next payday:/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Plan it/ })).toBeTruthy();
  });

  it('refuses a salary of nothing', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /Save salary/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/salary you received/);
    expect(post).not.toHaveBeenCalled();
  });
});
