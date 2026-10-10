// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemePill } from './ThemePill';

beforeAll(() => {
  // jsdom has no matchMedia; the pill asks it about dark mode and reduced motion.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});
afterEach(() => { cleanup(); document.documentElement.classList.remove('theme-switching'); });

describe('the theme pill', () => {
  it('marks the current mode and changes on a tap', () => {
    const onChange = vi.fn();
    render(<ThemePill mode="system" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('changes once per tap, even though finger-down and the click both arrive', () => {
    const onChange = vi.fn();
    render(<ThemePill mode="light" onChange={onChange} />);
    const dark = screen.getByRole('radio', { name: 'Dark' });
    fireEvent.pointerDown(dark, { button: 0 });
    fireEvent.click(dark);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the chosen mode is tapped again', () => {
    const onChange = vi.fn();
    render(<ThemePill mode="dark" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves with the arrow keys', () => {
    const onChange = vi.fn();
    render(<ThemePill mode="light" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'Theme' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('system');
  });

  // Seen in a background pane: the reveal waited for a frame that never came,
  // and the theme never changed.
  it('still changes the theme when the reveal never gets a frame', async () => {
    const onChange = vi.fn();
    const doc = document as unknown as { startViewTransition?: unknown };
    const hidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    doc.startViewTransition = () => ({ ready: new Promise(() => {}), finished: new Promise(() => {}) });
    try {
      render(<ThemePill mode="light" onChange={onChange} />);
      fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
      expect(onChange).not.toHaveBeenCalled();
      await new Promise((r) => setTimeout(r, 450));
      expect(onChange).toHaveBeenCalledWith('dark');
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(doc, 'startViewTransition');
      Reflect.deleteProperty(document, 'hidden');
      if (hidden) Object.defineProperty(Document.prototype, 'hidden', hidden);
    }
  });

  it('switches every other colour fade off only while it changes', async () => {
    const onChange = vi.fn();
    render(<ThemePill mode="light" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.classList.contains('theme-switching')).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    expect(document.documentElement.classList.contains('theme-switching')).toBe(false);
  });
});
