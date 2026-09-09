/**
 * Where this phone keeps its opinion about which payments need no tap.
 *
 * Deliberately per-device rather than per-account on the server, for two
 * reasons. Capture itself is per-device - the notifications only exist on the
 * phone that saw them - so trust earned here describes this phone's traffic.
 * And a device-local store fails in the safe direction: cleared storage means
 * an empty ledger, which means nothing is trusted, which means the app goes
 * back to asking. A server-side flag read through the app's usual
 * fetch-with-defaults pattern would do the opposite, and a cold backend would
 * switch this ON for every pattern at exactly the moment nothing can be
 * checked.
 *
 * Everything here is wrapped so a storage failure is silence rather than a
 * crash - and silence, for this feature, means asking the user.
 */
import {
  DEFAULT_SETTINGS, parseSettings, parseTrustLedger, revokeKey,
  type AutoAddSettings, type TrustLedger,
} from '../utils/autoAdd';
import { getCachedUser } from './apiClient';

/**
 * Every key here is scoped to whoever is signed in.
 *
 * Signing out clears the tokens and the cached user and nothing else, so an
 * unscoped key would outlive the person who created it. On a phone that gets
 * handed over - a family phone, a resold one - the next person to sign in
 * would find this feature already switched ON, carrying somebody else's earned
 * trust, and payments would start being written into THEIR ledger against a
 * consent they never gave and patterns they never confirmed.
 *
 * Scoping removes that rather than papering over it: a different account reads
 * a different key, finds nothing, and gets the default - which is off.
 */
const scoped = (base: string): string => `${base}:${getCachedUser()?.id ?? 'anon'}`;

const SETTINGS_KEY = 'moneva_auto_add_settings';
const TRUST_KEY = 'moneva_auto_add_trust';

/** What the user has chosen. Anything unreadable means "off". */
export const loadAutoAddSettings = (): AutoAddSettings => {
  try {
    return parseSettings(localStorage.getItem(scoped(SETTINGS_KEY)));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveAutoAddSettings = (settings: AutoAddSettings): void => {
  try {
    localStorage.setItem(scoped(SETTINGS_KEY), JSON.stringify(settings));
  } catch {
    /* Unwritable storage means the setting does not stick, and not sticking
       means it reverts to off - which is the right way for this to fail. */
  }
};

/** Which patterns have earned the tap. Anything unreadable means none. */
export const loadTrustLedger = (): TrustLedger => {
  try {
    return parseTrustLedger(localStorage.getItem(scoped(TRUST_KEY)));
  } catch {
    return {};
  }
};

export const saveTrustLedger = (ledger: TrustLedger): void => {
  try {
    localStorage.setItem(scoped(TRUST_KEY), JSON.stringify(ledger));
  } catch {
    /* A confirmation that cannot be saved simply is not counted. The user
       taps once more; nothing is filed that should not have been. */
  }
};

/**
 * Forget every opinion this phone holds.
 *
 * Wired to the switch being turned off as well as to an explicit reset,
 * because somebody turning this off after it got something wrong means "stop,
 * and do not pick up where you left off" - not "pause".
 */
export const forgetAllTrust = (): void => {
  try {
    localStorage.removeItem(scoped(TRUST_KEY));
    localStorage.removeItem(scoped(ORIGINS_KEY));
  } catch {
    /* Nothing to do; the ledger is only ever an optimisation over asking. */
  }
};

/**
 * Which pattern filed which row.
 *
 * A transaction carries no rule name - only the device_id marker below - so
 * without this, "the user just deleted something that was added for them"
 * cannot be turned into "so stop trusting the pattern that added it". That is
 * the single most important signal this feature can receive, because it is the
 * only one that arrives AFTER a wrong row already existed.
 *
 * Keyed by client_mutation_id, which the row carries and which is derived from
 * the payment itself. Bounded, because this is a convenience for undo and not
 * a record worth growing forever - and the oldest entries are the least likely
 * to be undone.
 */
const ORIGINS_KEY = 'moneva_auto_add_origins';
const MAX_ORIGINS = 300;

export const rememberOrigin = (mutationId: string, trustKey: string): void => {
  if (!mutationId || !trustKey) return;
  try {
    const raw = localStorage.getItem(scoped(ORIGINS_KEY));
    const map: Record<string, string> = raw ? JSON.parse(raw) : {};
    map[mutationId] = trustKey;
    const keys = Object.keys(map);
    if (keys.length > MAX_ORIGINS) {
      for (const k of keys.slice(0, keys.length - MAX_ORIGINS)) delete map[k];
    }
    localStorage.setItem(scoped(ORIGINS_KEY), JSON.stringify(map));
  } catch {
    /* Losing this costs the undo signal for one row, not correctness. */
  }
};

/** The pattern that filed this row, if this device remembers filing it. */
export const originOf = (mutationId: string | null | undefined): string | null => {
  if (!mutationId) return null;
  try {
    const raw = localStorage.getItem(scoped(ORIGINS_KEY));
    if (!raw) return null;
    const map = JSON.parse(raw);
    const found = map && typeof map === 'object' ? map[mutationId] : null;
    return typeof found === 'string' && found ? found : null;
  } catch {
    return null;
  }
};

export const forgetOrigins = (): void => {
  try {
    localStorage.removeItem(scoped(ORIGINS_KEY));
  } catch {
    /* nothing depends on this beyond the undo signal */
  }
};

/**
 * The user removed a row that was filed for them - so stop trusting whatever
 * filed it. Safe to call with any transaction: rows this device did not file
 * are simply not remembered, and nothing happens.
 */
export const revokeTrustForDeletedRow = (
  row: { client_mutation_id?: string | null; device_id?: string | null },
  now: number,
): boolean => {
  if (!wasAutoAdded(row)) return false;
  const key = originOf(row.client_mutation_id);
  if (!key) return false;
  saveTrustLedger(revokeKey(loadTrustLedger(), key, now));
  return true;
};

/**
 * The marker that says a row was filed without being asked about.
 *
 * A distinct device_id rather than a new column: the field already carries
 * provenance elsewhere in the app ('statement-import', 'web-client'), it is
 * stored on every transaction, and it needs no migration. Without it, "show me
 * what was added without me" and "undo what that rule wrote" are questions
 * with no query behind them, because a hand-confirmed row and an automatic one
 * would be indistinguishable.
 */
export const AUTO_ADDED_DEVICE_ID = 'android-auto-added';

/** Whether a ledger row was filed by this feature rather than by a person. */
export const wasAutoAdded = (row: { device_id?: string | null }): boolean =>
  row.device_id === AUTO_ADDED_DEVICE_ID;
