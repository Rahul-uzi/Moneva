/**
 * Whether balances are masked on this device.
 *
 * Deliberately per-device rather than per-account: the point is that someone
 * looking over your shoulder on the bus cannot read your net worth, which is a
 * property of where you are, not of who you are.
 *
 * Every access is guarded. Storage throws outright in some privacy modes, and
 * a thrown preference must never be the reason the app fails to start.
 */
const KEY = 'moneva.balances-hidden';

export const readBalancesHidden = (): boolean => {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

export const writeBalancesHidden = (hidden: boolean): void => {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(KEY, hidden ? '1' : '0');
  } catch {
    // Private mode, or storage disabled. The toggle still works for this
    // session; it just will not be remembered.
  }
};
