import { Preferences } from '@capacitor/preferences';

const PENDING_KEY = 'moneva_tour_pending';

/**
 * The guided tour - spotlights over the real screens - as opposed to the
 * welcome slideshow, which only describes them.
 *
 * Same contract as onboardingService: it runs when explicitly requested (right
 * after the slideshow for a new account, or from Profile), never merely
 * because a flag is absent, so a reinstall does not re-run it.
 */
export const TOUR_REQUESTED = 'moneva:tour-requested';

export const markTourPending = (): void => {
  try {
    localStorage.setItem(PENDING_KEY, 'true');
  } catch {
    /* storage unavailable - the in-memory flow still shows it this session */
  }
  void Preferences.set({ key: PENDING_KEY, value: 'true' }).catch(() => {});
  window.dispatchEvent(new Event(TOUR_REQUESTED));
};

export const isTourPending = (): boolean => {
  try {
    return localStorage.getItem(PENDING_KEY) === 'true';
  } catch {
    return false;
  }
};

export const completeTour = (): void => {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
  void Preferences.remove({ key: PENDING_KEY }).catch(() => {});
};
