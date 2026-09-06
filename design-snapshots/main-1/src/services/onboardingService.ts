import { Preferences } from '@capacitor/preferences';

const PENDING_KEY = 'moneva_onboarding_pending';

/**
 * The tutorial is opt-in by signup, not by absence of a flag.
 *
 * Registration explicitly marks it pending, so a returning user reinstalling
 * the app is never interrupted by a walkthrough they have already seen, while
 * a genuinely new account always gets it.
 */
export const ONBOARDING_REQUESTED = 'moneva:onboarding-requested';

export const markOnboardingPending = (): void => {
  try {
    localStorage.setItem(PENDING_KEY, 'true');
  } catch {
    // Storage unavailable - the in-memory flow still shows it this session.
  }
  void Preferences.set({ key: PENDING_KEY, value: 'true' }).catch(() => {});
  // The shell may already be mounted (replay from Profile), so tell it directly
  // rather than relying on it re-reading storage.
  window.dispatchEvent(new Event(ONBOARDING_REQUESTED));
};

export const isOnboardingPending = (): boolean => {
  try {
    return localStorage.getItem(PENDING_KEY) === 'true';
  } catch {
    return false;
  }
};

export const completeOnboarding = (): void => {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
  void Preferences.remove({ key: PENDING_KEY }).catch(() => {});
};
