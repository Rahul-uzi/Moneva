// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ActionProposalCard, type ProposedAction } from './ActionProposalCard';

/**
 * The assistant's spending plan, asking to be kept.
 *
 * "Make a plan for my salary" used to end in a paragraph with nowhere to go.
 * Now it ends in this card, and the card must say exactly what yes would do.
 */

afterEach(cleanup);

const plan = (over: Partial<ProposedAction> = {}): ProposedAction => ({
  type: 'budget_plan',
  amountPaise: 650000,
  description: 'October plan',
  planItems: [
    { categoryId: 'c1', categoryName: 'Food & Dining', amountPaise: 400000, currentPaise: 300000 },
    { categoryId: 'c2', categoryName: 'Groceries', amountPaise: 250000, currentPaise: null },
  ],
  ...over,
});

describe('the plan card', () => {
  it('asks where it is going, in plain words', () => {
    render(<ActionProposalCard proposal={plan()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Save this plan to your Plan tab?')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Save to Plan/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Not now/ })).toBeTruthy();
  });

  it('shows each category, and what an existing budget would change from', () => {
    render(<ActionProposalCard proposal={plan()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Food & Dining')).toBeTruthy();
    expect(screen.getByText(/3,000\.00\s*→/)).toBeTruthy();
    expect(screen.getByText('Groceries')).toBeTruthy();
  });

  it('totals the lines itself', () => {
    render(<ActionProposalCard proposal={plan()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const total = screen.getByText('Monthly spending limit').parentElement!;
    expect(total.textContent).toMatch(/6,500\.00/);
  });

  it('names what it left out instead of guessing a category', () => {
    render(
      <ActionProposalCard
        proposal={plan({ planUnmatched: ['Pet care'] })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/no category called Pet care/)).toBeTruthy();
  });

  it('cannot save a plan with nothing in it', () => {
    render(
      <ActionProposalCard
        proposal={plan({ planItems: [], planUnmatched: ['Pet care'] })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const save = screen.getByRole('button', { name: /Save to Plan/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('saves only when asked, and stays put when told not now', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(<ActionProposalCard proposal={plan()} onConfirm={onConfirm} onCancel={onCancel} />);

    screen.getByRole('button', { name: /Not now/ }).click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    screen.getByRole('button', { name: /Save to Plan/ }).click();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });
});
