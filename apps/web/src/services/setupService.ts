import { Preferences } from '@capacitor/preferences';

const PENDING_KEY = 'moneva_setup_pending';

/**
 * The two steps that decide whether the app is worth opening a second time.
 *
 * Registration creates a user and nothing else - no account, no history. So a
 * brand-new user finished the welcome slides and the guided tour and arrived
 * at a set of screens that were all correct and all empty, with no indication
 * that the emptiness was theirs to fix rather than the app failing to load.
 *
 * Meanwhile the app could already read a bank statement - HDFC, ICICI, SBI and
 * Axis exports, columns sniffed rather than assumed - and that feature was in
 * Profile, four taps from anywhere, which is where a new user never looks.
 *
 * This runs between the slideshow and the guided tour, and it is the same
 * contract as onboardingService and tourService: it runs when explicitly
 * requested, never merely because a flag is absent, so a reinstall does not
 * re-run it for someone who has done it already.
 */
export const SETUP_REQUESTED = 'moneva:setup-requested';

export const markSetupPending = (): void => {
  try {
    localStorage.setItem(PENDING_KEY, 'true');
  } catch {
    /* storage unavailable - the in-memory flow still shows it this session */
  }
  void Preferences.set({ key: PENDING_KEY, value: 'true' }).catch(() => {});
  window.dispatchEvent(new Event(SETUP_REQUESTED));
};

export const isSetupPending = (): boolean => {
  try {
    return localStorage.getItem(PENDING_KEY) === 'true';
  } catch {
    return false;
  }
};

export const completeSetup = (): void => {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
  void Preferences.remove({ key: PENDING_KEY }).catch(() => {});
};
