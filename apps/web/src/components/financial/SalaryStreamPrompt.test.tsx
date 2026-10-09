// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { SalaryStreamPrompt } from './SalaryStreamPrompt';
import type { IncomeLike, SalaryMatch } from '../../utils/salaryMatch';
import type { RecurringIncome } from '../../types/api';

const patch = vi.fn();
vi.mock('../../services/apiClient', () => ({
  apiClient: {
    patch: (...args: unknown[]) => patch(...args),
  },
}));

afterEach(() => {
  cleanup();
  patch.mockReset();
});

const stream: RecurringIncome = {
  id: 'stream-1',
  user_id: 'u1',
  source: 'Infosys',
  amount_minor: 3150000,
  frequency: 'monthly',
  next_occurrence: '2026-10-10T00:00:00Z',
  anchor_day: 10,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const income: IncomeLike = {
  amountPaise: 3150000,
  at: new Date('2026-10-08T09:00:00Z'),
  text: 'Infosys salary',
};

const match = (over: Partial<SalaryMatch> = {}): SalaryMatch => ({
  stream,
  amountChanged: false,
  ...over,
});

describe('SalaryStreamPrompt', () => {
  it('names the stream and shows both figures', () => {
    render(<SalaryStreamPrompt match={match()} income={income} onDone={() => {}} />);
    expect(screen.getByText('Infosys')).toBeTruthy();
    expect(screen.getAllByText(/31,500/).length).toBeGreaterThanOrEqual(2);
  });

  // The whole point: the money is already saved, so this sheet must never
  // appear when there is nothing to ask about.
  it('renders nothing without a match', () => {
    const { container } = render(
      <SalaryStreamPrompt match={null} income={income} onDone={() => {}} />,
    );
    expect(container.textContent).toBe('');
  });

  it('moves the payday on when the user says yes', async () => {
    patch.mockResolvedValue({ data: {} });
    const onDone = vi.fn();
    render(<SalaryStreamPrompt match={match()} income={income} onDone={onDone} />);

    screen.getByText('Yes, that was my salary').click();

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    const [url, body] = patch.mock.calls[0] as [string, { next_occurrence: string }];
    expect(url).toBe('/income/recurring/stream-1');
    expect(body.next_occurrence.slice(0, 10)).toBe('2026-11-10');
    // The expected amount is deliberately left alone.
    expect(Object.keys(body)).toEqual(['next_occurrence']);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('touches nothing when the user says no', () => {
    const onDone = vi.fn();
    render(<SalaryStreamPrompt match={match()} income={income} onDone={onDone} />);
    screen.getByText('No, it was something else').click();
    expect(patch).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  // A failed PATCH leaves the income recorded and the countdown stale. It must
  // still close, and it must not claim success.
  it('closes even when the stream could not be moved', async () => {
    patch.mockRejectedValue(new Error('offline'));
    const onDone = vi.fn();
    render(<SalaryStreamPrompt match={match()} income={income} onDone={onDone} />);
    screen.getByText('Yes, that was my salary').click();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('explains itself when the figure differs', () => {
    render(
      <SalaryStreamPrompt
        match={match({ amountChanged: true })}
        income={{ ...income, amountPaise: 2800000 }}
        onDone={() => {}}
      />,
    );
    expect(screen.getByText(/different amount is fine/i)).toBeTruthy();
  });
});
