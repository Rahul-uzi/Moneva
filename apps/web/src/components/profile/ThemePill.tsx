import React, { useRef } from 'react';
import { flushSync } from 'react-dom';
import { Moon, Smartphone, Sun } from 'lucide-react';
import { resolveTheme, type ThemeMode } from '../../services/themeService';
import './ThemePill.css';

const MODES: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: 'light', label: 'Light', Icon: Sun },
  { mode: 'dark', label: 'Dark', Icon: Moon },
  { mode: 'system', label: 'System', Icon: Smartphone },
];

interface ThemePillProps {
  mode: ThemeMode;
  /** Must apply the theme synchronously: the reveal photographs the result. */
  onChange: (mode: ThemeMode) => void;
}

type ViewTransitionDoc = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> };
};

/**
 * Light / Dark / System as one sliding pill.
 *
 * When the colours actually change, the new theme spreads out in a circle
 * from the button that was touched. Kept light on purpose - the first version
 * felt laggy:
 *   - it starts on finger-down, not finger-up;
 *   - every other colour fade on the page is switched off for that moment
 *     (`theme-switching` on <html>), so only the circle moves;
 *   - it lasts 0.42 s, and not at all with reduced motion.
 */
export const ThemePill: React.FC<ThemePillProps> = ({ mode, onChange }) => {
  const wanted = useRef(mode);
  const index = MODES.findIndex((m) => m.mode === mode);

  const choose = (next: ThemeMode, from: HTMLElement | null) => {
    if (next === wanted.current) return;
    wanted.current = next;

    const root = document.documentElement;
    let applied = false;
    const apply = () => {
      if (applied) return;
      applied = true;
      root.classList.add('theme-switching');
      flushSync(() => onChange(next));
    };
    const settle = () => requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));

    const doc = document as ViewTransitionDoc;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (resolveTheme(mode) === resolveTheme(next) || !from || !doc.startViewTransition || reduce || document.hidden) {
      apply();
      settle();
      return;
    }

    const r = from.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const end = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const t = doc.startViewTransition(apply);
    /* The reveal waits for the screen to draw a frame before it changes
       anything. If none comes (the app was sent to the background at that
       instant), the theme must still change - never a pill stuck half-way. */
    setTimeout(() => { if (!applied) { apply(); settle(); } }, 400);
    t.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
          { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' },
        );
      })
      .catch(() => {});
    t.finished.finally(settle).catch(() => {});
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = MODES[(index + step + MODES.length) % MODES.length];
    const el = e.currentTarget.querySelector<HTMLButtonElement>(`[data-mode="${next.mode}"]`);
    choose(next.mode, el);
    el?.focus();
  };

  return (
    <div
      className="pf-seg"
      role="radiogroup"
      aria-label="Theme"
      style={{ '--i': index } as React.CSSProperties}
      onKeyDown={onKeyDown}
    >
      <span className="pf-seg-thumb" aria-hidden="true" />
      {MODES.map(({ mode: m, label, Icon }) => (
        <button
          key={m}
          type="button"
          role="radio"
          data-mode={m}
          aria-checked={mode === m}
          tabIndex={mode === m ? 0 : -1}
          onPointerDown={(e) => { if (e.button === 0) choose(m, e.currentTarget); }}
          onClick={(e) => choose(m, e.currentTarget)}
        >
          <Icon size={16} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
};
