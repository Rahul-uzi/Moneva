import React, { useRef, useState } from 'react';
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

/* The new theme's page colour (--moneva-bg in each palette, index.css). The
   circle is painted in it, so the page underneath can change unseen. */
const WASH = { light: '#F2F1EC', dark: '#0A0B0D' } as const;
/** Radius of the circle before it is scaled up. */
const BASE = 160;
/** When the page starts changing colour under the growing circle, in ms. */
const RECOLOUR_AT = 200;

/**
 * A copy of the pill's card, laid over the circle while it grows.
 *
 * The circle is drawn above the whole page, so it also covered the pill - and
 * the thumb sliding to the new choice, the part that says "you picked this",
 * happened out of sight. The copy sits above the circle at the same place and
 * slides its own thumb across.
 */
const pillGhost = (from: HTMLElement, next: ThemeMode): HTMLElement | null => {
  const seg = from.closest<HTMLElement>('.pf-seg');
  if (!seg) return null;
  const card = seg.closest<HTMLElement>('[data-pill-card]') ?? seg;
  const box = card.getBoundingClientRect();
  const was = Number(seg.style.getPropertyValue('--i') || 0);
  const to = MODES.findIndex((m) => m.mode === next);

  const ghost = card.cloneNode(true) as HTMLElement;
  ghost.classList.add('theme-ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.removeAttribute('data-pill-card');
  ghost.querySelectorAll('[role]').forEach((n) => n.removeAttribute('role'));
  ghost.querySelectorAll('button').forEach((b) => { b.tabIndex = -1; });
  ghost.style.left = `${box.left}px`;
  ghost.style.top = `${box.top}px`;
  ghost.style.width = `${box.width}px`;
  ghost.style.height = `${box.height}px`;

  /* Measured on the A33: a copy that faded its labels and turned its icons
     with ordinary CSS transitions, after a forced layout to start them, made
     a quarter of the frames late. So everything in the copy changes at once,
     except the thumb - which slides with the Web Animations API, on the
     graphics chip, from where it was to where it is going. */
  const ghostSeg = ghost.classList.contains('pf-seg') ? ghost : ghost.querySelector<HTMLElement>('.pf-seg');
  ghostSeg?.style.setProperty('--i', String(to));
  ghostSeg?.querySelectorAll<HTMLElement>('button[data-mode]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.mode === next));
  });
  document.body.appendChild(ghost);
  ghostSeg?.querySelector<HTMLElement>('.pf-seg-thumb')?.animate(
    [{ transform: `translateX(${was * 100}%)` }, { transform: `translateX(${to * 100}%)` }],
    { duration: 300, easing: 'cubic-bezier(.3,1.3,.5,1)', fill: 'forwards' },
  );
  return ghost;
};

/**
 * Light / Dark / System as one sliding pill.
 *
 * When the colours actually change, a circle of the new page colour spreads
 * out from the finger, the theme changes underneath it, and the circle fades
 * away. Built only from `transform` and `opacity`, the two things a phone's
 * graphics chip animates on its own.
 *
 * Measured on a Galaxy A33: the first version revealed the new page through a
 * growing clip-path over a full-screen snapshot, which the processor had to
 * redraw every frame - median 48-61 ms per frame, 70% of frames late, while
 * opening a sheet ran at 12 ms. This one runs at 11-16 ms per frame, with the
 * one expensive recolour hidden under the circle.
 */
export const ThemePill: React.FC<ThemePillProps> = ({ mode, onChange }) => {
  const wanted = useRef(mode);
  // The thumb moves the moment the finger lands; the page follows under the circle.
  const [pending, setPending] = useState<ThemeMode | null>(null);
  const shown = pending ?? mode;
  const index = MODES.findIndex((m) => m.mode === shown);

  const choose = (next: ThemeMode, from: HTMLElement | null) => {
    if (next === wanted.current) return;
    wanted.current = next;

    const root = document.documentElement;
    let applied = false;
    const apply = () => {
      if (applied) return;
      applied = true;
      root.classList.add('theme-switching');
      flushSync(() => { setPending(null); onChange(next); });
    };
    const settle = () => setTimeout(() => root.classList.remove('theme-switching'), 50);

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (resolveTheme(mode) === resolveTheme(next) || !from || reduce || document.hidden || !document.body.animate) {
      apply();
      settle();
      return;
    }

    // Taken before React moves the real pill, so the copy starts where it was.
    const ghost = pillGhost(from, next);
    setPending(next);
    const r = from.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const reach = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    const wash = document.createElement('div');
    wash.className = 'theme-wash';
    wash.setAttribute('aria-hidden', 'true');
    wash.style.left = `${x - BASE}px`;
    wash.style.top = `${y - BASE}px`;
    wash.style.background = WASH[resolveTheme(next)];
    document.body.appendChild(wash);

    /* The page is recoloured while the circle is still growing. Working out
       a new theme for the whole page takes about 0.28 s on a Galaxy A33, and
       waiting for the circle to finish first left the screen one flat colour
       for that long. The circle keeps growing meanwhile - the graphics chip
       moves it, not the busy processor - and by the time the new colours are
       ready it covers the screen. Then it fades. */
    let grown = false;
    let painted = false;
    let fading = false;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      wash.remove();
      ghost?.remove();
      settle();
    };
    const fadeOut = () => {
      if (!grown || !painted || fading) return;
      fading = true;
      const fade = wash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
      // The real pill underneath already looks exactly like the copy, so the
      // copy simply goes with the circle.
      ghost?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
      fade.onfinish = cleanup;
    };
    const grow = wash.animate(
      [{ transform: 'scale(0)' }, { transform: `scale(${reach / BASE})` }],
      { duration: 380, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' },
    );
    grow.onfinish = () => { grown = true; fadeOut(); };
    setTimeout(() => {
      apply();
      // Two frames: the first is the long one that paints the new colours.
      requestAnimationFrame(() => requestAnimationFrame(() => { painted = true; fadeOut(); }));
    }, RECOLOUR_AT);
    // Never a pill stuck half-way or a circle left on screen, even if no
    // frame ever comes (the app sent to the background mid-switch).
    setTimeout(() => { apply(); cleanup(); }, 1200);
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
          aria-checked={shown === m}
          tabIndex={shown === m ? 0 : -1}
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
