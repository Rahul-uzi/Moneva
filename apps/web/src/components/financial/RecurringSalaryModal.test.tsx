// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RecurringSalaryModal } from './RecurringSalaryModal';
import type { RecurringIncome } from '../../types/api';

/**
 * The salary schedule: what the app is waiting for, and how to change it.
 */

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
};

const STREAM: RecurringIncome = {
  id: 'stream-1', user_id: 'u', source: 'Monthly Salary', amount_minor: 3150000,
  frequency: 'monthly', next_occurrence: inDays(5), anchor_day: 10,
  active: true, created_at: '', updated_at: '',
};

let streams: RecurringIncome[] = [];
beforeEach(() => {
  streams = [STREAM];
  get.mockImplementation(() => Promise.resolve({ data: streams }));
  post.mockResolvedValue({ data: {} });
  del.mockResolvedValue({});
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const openSheet = (onSelect = vi.fn(), onClose = vi.fn()) =>
  render(<RecurringSalaryModal isOpen onClose={onClose} onSelectForConfirmation={onSelect} />);

const tap = (value: string) => {
  for (const ch of value) {
    fireEvent.click(screen.getByRole('button', { name: ch === '.' ? 'Decimal point' : ch }));
  }
};

describe('Salary schedule', () => {
  it('says how far away the next payday is', async () => {
    openSheet();
    expect(await screen.findByText(/Every month · Next .* · in 5 days/)).toBeTruthy();
  });

  // It was one tap on a bare bin icon, beside the button people meant to press.
  it('asks before removing a schedule', async () => {
    openSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Monthly Salary' }));
    expect(del).not.toHaveBeenCalled();
    expect(screen.getByText('Remove this schedule?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.queryByText('Remove this schedule?')).toBeNull();
    expect(del).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Monthly Salary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/income/recurring/stream-1'));
  });

  it('hands a schedule to the salary sheet when it has arrived', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    openSheet(onSelect, onClose);
    fireEvent.click(await screen.findByRole('button', { name: /Received/ }));
    expect(onSelect).toHaveBeenCalledWith(STREAM);
    expect(onClose).toHaveBeenCalled();
  });

  // The old screen saved "bi-weekly", which nothing recognised.
  it('saves a fortnightly salary in the spelling everything reads', async () => {
    openSheet();
    fireEvent.click(await screen.findByRole('button', { name: /Add another salary/ }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: 'Side Job' } });
    tap('8000');
    fireEvent.click(screen.getByRole('radio', { name: 'Every 2 weeks' }));
    fireEvent.change(screen.getByLabelText('Next payday'), { target: { value: '2026-10-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/income/recurring');
    expect(body).toMatchObject({ source: 'Side Job', amount_minor: 800000, frequency: 'biweekly', anchor_day: 31 });
    // Stored on the 31st in local time, not slipped to the 30th through UTC.
    expect(new Date(body.next_occurrence as string).getDate()).toBe(31);
  });

  it('opens straight to adding one when nothing is scheduled', async () => {
    streams = [];
    openSheet();
    expect(await screen.findByRole('button', { name: 'Not now' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save schedule' })).toBeTruthy();
  });

  it('refuses a schedule with no name', async () => {
    streams = [];
    openSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Save schedule' }));
    expect(screen.getByRole('alert').textContent).toMatch(/who pays you/i);
    expect(post).not.toHaveBeenCalled();
  });
});
