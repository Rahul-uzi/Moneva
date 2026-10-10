// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Card } from './Card';

afterEach(() => cleanup());

describe('a tappable card', () => {
  // Keyboard and screen-reader users could not open an account at all.
  it('is a button that Enter and Space open', () => {
    const onClick = vi.fn();
    render(<Card asButton onClick={onClick}>City Bank Savings</Card>);
    const card = screen.getByRole('button', { name: 'City Bank Savings' });
    expect(card.tabIndex).toBe(0);
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  // A button cannot hold buttons: a card with its own Pay or Contribute stays
  // a container, so those inner buttons remain reachable.
  it('is not made a button unless asked, so buttons inside stay reachable', () => {
    render(<Card onClick={() => {}}><button type="button">Pay</button></Card>);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Pay' })).toBeTruthy();
  });

  it('stays a plain container when nothing happens on tap', () => {
    render(<Card>Summary</Card>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
