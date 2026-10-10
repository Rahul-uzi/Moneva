// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  describe('the circle', () => {
    let animations: { el: Element; keyframes: Keyframe[]; onfinish: (() => void) | null }[];
    const on = (cls: string) => animations.filter((a) => a.el.classList.contains(cls));
    const hidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    beforeEach(() => {
      animations = [];
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      // jsdom has no Web Animations; record each one and let the test finish it.
      (Element.prototype as unknown as { animate: unknown }).animate = function (this: Element, keyframes: Keyframe[]) {
        const a = { el: this, keyframes, onfinish: null as (() => void) | null, cancel: () => {} };
        animations.push(a);
        return a;
      };
    });
    afterEach(() => {
      Reflect.deleteProperty(Element.prototype, 'animate');
      Reflect.deleteProperty(document, 'hidden');
      if (hidden) Object.defineProperty(Document.prototype, 'hidden', hidden);
      document.querySelectorAll('.theme-wash, .theme-ghost').forEach((n) => n.remove());
    });

    it('moves the pill at once and recolours the page while the circle grows', async () => {
      const onChange = vi.fn();
      render(<ThemePill mode="light" onChange={onChange} />);
      fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));

      expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
      expect(onChange).not.toHaveBeenCalled();
      const wash = document.querySelector<HTMLElement>('.theme-wash');
      expect(wash?.style.background).toBe('rgb(10, 11, 13)');

      // Before the circle has finished growing, not after.
      await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
      expect(onChange).toHaveBeenCalledWith('dark');
      expect(on('theme-wash')).toHaveLength(1);
    });

    it('fades the circle only once it has grown AND the new colours are painted', async () => {
      render(<ThemePill mode="light" onChange={() => {}} />);
      fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
      await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
      expect(on('theme-wash')).toHaveLength(1); // still growing: no fade yet
      act(() => { on('theme-wash')[0].onfinish?.(); });
      // The circle's fade, and the pill copy's fade with it.
      expect(on('theme-wash')).toHaveLength(2);
      expect(on('theme-ghost')).toHaveLength(1);
      act(() => { on('theme-wash')[1].onfinish?.(); });
      expect(document.querySelector('.theme-wash')).toBeNull();
    });

    // Seen on the phone: the circle covered the pill, so the thumb's slide
    // to the new choice could not be seen.
    it('keeps a copy of the pill above the circle, sliding to the new choice', async () => {
      render(
        <div data-pill-card>
          <ThemePill mode="light" onChange={() => {}} />
        </div>,
      );
      fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
      const ghost = document.querySelector<HTMLElement>('.theme-ghost');
      expect(ghost).toBeTruthy();
      // Hidden from screen readers, and not a second set of radio buttons.
      expect(ghost!.getAttribute('aria-hidden')).toBe('true');
      expect(ghost!.querySelector('[role]')).toBeNull();
      expect(ghost!.querySelector<HTMLElement>('.pf-seg')!.style.getPropertyValue('--i')).toBe('1');
      expect(ghost!.querySelector('[data-mode="dark"]')!.getAttribute('aria-checked')).toBe('true');
      // Only one real pill remains for assistive technology.
      expect(screen.getAllByRole('radiogroup')).toHaveLength(1);

      // Its thumb slides from Light (0) to Dark (1) on the graphics chip.
      const slide = on('pf-seg-thumb');
      expect(slide).toHaveLength(1);
      expect(slide[0].keyframes).toEqual([{ transform: 'translateX(0%)' }, { transform: 'translateX(100%)' }]);

      await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
      act(() => { on('theme-wash')[0].onfinish?.(); });
      act(() => { on('theme-wash')[1].onfinish?.(); });
      expect(document.querySelector('.theme-ghost')).toBeNull();
    });

    // The whole point of the rebuild: nothing that makes the phone redraw.
    it('animates only transform and opacity', async () => {
      render(<ThemePill mode="light" onChange={() => {}} />);
      fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
      await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
      act(() => { on('theme-wash')[0].onfinish?.(); });
      const props = animations.flatMap((a) => a.keyframes.flatMap((k) => Object.keys(k)));
      expect(new Set(props)).toEqual(new Set(['transform', 'opacity']));
    });

    // Seen in a background pane: an animation that never ends left the theme unchanged.
    it('still changes the theme, and clears the circle, if nothing ever finishes', async () => {
      const onChange = vi.fn();
      render(<ThemePill mode="light" onChange={onChange} />);
      fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
      await act(async () => { await new Promise((r) => setTimeout(r, 1250)); });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith('dark');
      expect(document.querySelector('.theme-wash')).toBeNull();
    });
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
