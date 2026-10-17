// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BottomNavigation } from './BottomNavigation';

afterEach(cleanup);

const open = (path: string, onQuickAddClick = vi.fn()) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNavigation onQuickAddClick={onQuickAddClick} />
    </MemoryRouter>,
  );

describe('the tab bar', () => {
  // The button stays centred only because it sits between two halves of
  // equal width - two tabs each side, whichever tab is open.
  it('puts two tabs on each side of the add button', () => {
    const { container } = open('/activity');
    const [start, end] = container.querySelectorAll('.dock-side');
    expect([...start.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Home', 'Activity']);
    expect([...end.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Plan', 'Ask']);
    const dock = container.querySelector('.dock')!;
    expect([...dock.children].map((c) => c.className)).toEqual(['dock-side dock-side--start', 'quick-action-btn', 'dock-side dock-side--end']);
  });

  it('marks only the open tab', () => {
    open('/plan/budgets');
    expect(screen.getByRole('button', { name: 'Plan' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current'))).toHaveLength(1);
  });

  it('marks nothing on a page without a tab', () => {
    open('/profile');
    expect(screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current'))).toHaveLength(0);
  });

  it('opens quick add from the middle button', () => {
    const onQuickAddClick = vi.fn();
    const { container } = open('/', onQuickAddClick);
    fireEvent.click(container.querySelector('.quick-action-btn')!);
    expect(onQuickAddClick).toHaveBeenCalledTimes(1);
  });
});
