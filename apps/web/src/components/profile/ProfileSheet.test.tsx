// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProfileSheet } from './ProfileSheet';

afterEach(() => { cleanup(); });

describe('the Profile sheet', () => {
  it('closes with Escape, the X and the dimmed page', () => {
    const onClose = vi.fn();
    const { container } = render(<ProfileSheet isOpen title="Currency" onClose={onClose}>body</ProfileSheet>);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(container.querySelector('.pf-sheet-shade')!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  /* Android's Back goes back in history. Without its own history entry the
     sheet would stay open while Back left Profile altogether. */
  it('closes on Back instead of leaving the page', () => {
    const onClose = vi.fn();
    render(<ProfileSheet isOpen title="Currency" onClose={onClose}>body</ProfileSheet>);
    expect((window.history.state as { profileSheet?: boolean })?.profileSheet).toBe(true);
    act(() => {
      window.history.replaceState(null, '');
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays mounted for its closing slide, then goes', async () => {
    const { rerender } = render(<ProfileSheet isOpen title="Currency" onClose={() => {}}>body</ProfileSheet>);
    rerender(<ProfileSheet isOpen={false} title="Currency" onClose={() => {}}>body</ProfileSheet>);
    expect(screen.getByRole('dialog', { name: 'Currency' })).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 320)); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
