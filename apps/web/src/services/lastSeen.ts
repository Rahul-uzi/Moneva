/**
 * When this device last had the app open.
 *
 * Used to mark what arrived while you were away. Per-device on purpose: the
 * question is "what have I not seen", and what you have seen is a property of
 * the screen you were looking at.
 */
const KEY = 'moneva.last-seen';

export const readLastSeen = (): string | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export const writeLastSeen = (iso: string): void => {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(KEY, iso);
  } catch {
    // Storage disabled. Nothing gets marked new; nothing breaks.
  }
};
