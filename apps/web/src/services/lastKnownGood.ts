/**
 * The numbers you saw last time, kept so the app is never blank.
 *
 * TWO PROBLEMS, ONE ANSWER.
 *
 * The first is measured: the API answers a cold request in 42.9 seconds, of
 * which 0.14 is the network. It is a free-tier service that sleeps after
 * fifteen idle minutes, and the client was already doing everything right -
 * seven requests in parallel, a skeleton on screen - so there was nothing left
 * to optimise. The user simply watched a skeleton for the better part of a
 * minute, which is the single worst thing about using this app.
 *
 * The second was a lie. `OfflineState` said "showing the last data we saved on
 * this device" and nothing was ever saved: `cacheEntity` and `getCachedEntity`
 * had existed in offlineStore since the beginning with zero callers, and
 * `apiCache` is in-memory with a twenty-second TTL, so a cold start had
 * nothing. The app told people it had their data when it did not.
 *
 * Writing every successful GET to disk answers both. The app opens on real
 * figures - the ones from last time, labelled as such - and quietly replaces
 * them when the server wakes. The sentence becomes true, and the forty-three
 * seconds stop being something anyone stares at.
 *
 * WHAT THIS IS NOT. It is not offline mode. Nothing here queues a write or
 * reconciles a conflict; it is a read cache of last resort. Showing someone
 * their own figures from an hour ago, and saying so, is honest. Letting them
 * believe a stale balance is current is not - which is why every path out of
 * here carries the time it was saved, and why the UI is required to show it.
 */

import { cacheEntity, getCachedEntity } from './offlineStore';
import { getCachedUser } from './apiClient';

/** What is actually stored: the body, plus when it arrived. */
interface Envelope<T> {
  data: T;
  savedAt: number;
}

export interface StaleRead<T> {
  data: T;
  /** Epoch ms when the server last answered this request successfully. */
  savedAt: number;
}

/**
 * Paths worth keeping.
 *
 * An allowlist rather than everything, for two reasons. Writing to IndexedDB
 * on every GET costs something on a mid-range phone, and most endpoints are
 * not worth a disk write - a notification unread count restored from an hour
 * ago is noise, not help.
 *
 * More importantly, some answers must never be shown stale. `/auth/me` decides
 * what the app believes about who is signed in; a cached copy of that could
 * outlive the session it describes.
 */
const KEEP = [
  /^\/finance\/summary/,
  /^\/finance\/cash-flow/,
  /^\/finance\/account-balances/,
  /^\/finance\/analytics\//,
  /^\/accounts/,
  /^\/transactions(?!\/import)/,
  /^\/categories/,
  /^\/budgets/,
  /^\/goals/,
  /^\/bills/,
  /^\/income/,
  /^\/emis/,
];

export const isWorthKeeping = (url: string): boolean => KEEP.some((re) => re.test(url));

/**
 * Scoped to the signed-in account, always.
 *
 * Without this, the next person to use the phone - or the same person on a
 * second account - opens the app to the previous account's balances, rendered
 * as their own. A stale figure is recoverable; someone else's figure shown as
 * yours is not.
 */
const scopedKey = (key: string): string | null => {
  const userId = getCachedUser()?.id;
  return userId ? `lkg:${key}` : null;
};

/** Store one successful response. Never throws; a failed write is not an error. */
export const remember = async <T,>(key: string, data: T): Promise<void> => {
  const userId = getCachedUser()?.id;
  const scoped = scopedKey(key);
  if (!userId || !scoped) return;
  try {
    const envelope: Envelope<T> = { data, savedAt: Date.now() };
    await cacheEntity(userId, scoped, envelope);
  } catch {
    /* Storage full, private mode, a browser that refuses IndexedDB. The app
       works without this; it just opens blank, as it did before. */
  }
};

/** The last good answer for this request, or null if there has never been one. */
export const recall = async <T,>(key: string): Promise<StaleRead<T> | null> => {
  const userId = getCachedUser()?.id;
  const scoped = scopedKey(key);
  if (!userId || !scoped) return null;
  try {
    const envelope = await getCachedEntity<Envelope<T>>(userId, scoped);
    if (!envelope || typeof envelope.savedAt !== 'number') return null;
    return { data: envelope.data, savedAt: envelope.savedAt };
  } catch {
    return null;
  }
};

/**
 * Whether a failed request is the kind that a saved copy should answer.
 *
 * Only the ones that mean "the server did not answer". A 404 is an answer, and
 * so is a 403 - showing saved data instead of an authorisation error would
 * hide from someone that their session has ended, and they would go on reading
 * figures believing they were signed in.
 */
export const isReachabilityFailure = (status: number | undefined, code?: string): boolean => {
  if (status === undefined) return true;                    // no response at all
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return true;
  return status >= 500 && status <= 599;                    // the server is unwell
};

/**
 * How old this is, in words.
 *
 * Rendered next to the figures, so it has to be readable at a glance and it
 * has to be honest at the boundaries: "just now" for something a minute old is
 * fine, "just now" for something from yesterday is the lie this whole file
 * exists to remove.
 */
export const describeAge = (savedAt: number, now = Date.now()): string => {
  const seconds = Math.max(0, Math.floor((now - savedAt) / 1000));
  if (seconds < 90) return 'a moment ago';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
};
