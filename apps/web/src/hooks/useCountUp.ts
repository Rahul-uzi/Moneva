import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia !== undefined &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Ease-out cubic: most of the distance early, so the figure reads at once. */
const ease = (t: number): number => 1 - Math.pow(1 - t, 3);

/**
 * Counts a monetary figure up to its value on first paint.
 *
 * Only the 0..1 progress lives in state; the figure itself is derived from the
 * current target, so the exact value is always what is finally shown and a
 * later refresh flows straight through without replaying the count. Does
 * nothing under prefers-reduced-motion.
 */
export const useCountUp = (target: number, durationMs = 650): number => {
  // Lazily initialised so reduced-motion users start complete, rather than the
  // hook setting state during the effect to correct itself.
  const [progress, setProgress] = useState<number>(() => (prefersReducedMotion() ? 1 : 0));
  const started = useRef<boolean>(false);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (started.current || prefersReducedMotion()) return undefined;
    started.current = true;

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setProgress(t);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);

    // Fail-safe. requestAnimationFrame is paused while the page is hidden and
    // can be throttled by battery savers even when it is visible; without this
    // a stalled animation would leave a real balance reading as a partial
    // figure. The true value wins no matter what the frame clock does.
    const settle = window.setTimeout(() => setProgress(1), durationMs + 400);

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      window.clearTimeout(settle);
    };
  }, [durationMs]);

  return progress >= 1 ? target : Math.round(target * ease(progress));
};
