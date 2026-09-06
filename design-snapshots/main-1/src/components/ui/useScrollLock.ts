import React from 'react';

/**
 * Freezes the page behind an open overlay.
 *
 * The scroll box is `.app-content`, not `body`: the shell has a definite
 * height so the content column is what actually scrolls. Falls back to body
 * for any context where the shell is not mounted (auth screens).
 */
export const useScrollLock = (isLocked: boolean): void => {
  React.useEffect(() => {
    if (!isLocked) return;
    const el = document.querySelector<HTMLElement>('.app-content') ?? document.body;
    const previous = el.style.overflow;
    el.style.overflow = 'hidden';
    return () => {
      el.style.overflow = previous;
    };
  }, [isLocked]);
};
