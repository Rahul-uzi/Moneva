import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { currentVersionName } from './updateCheck';
import { versionCodeOf } from '../utils/version';
import { fetchManifest, shouldDownload } from '../utils/liveUpdateManifest';

/**
 * Live updates: new screens and fixes without an APK.
 *
 * The APK is a native shell around a web bundle - every screen, colour and
 * line of logic. A new bundle can therefore be shipped on its own:
 *
 *   1. Every time the app starts from closed, and on returns to it at most
 *      every 30 minutes, the signed manifest on the website is read and
 *      verified.
 *   2. If it names a newer bundle this shell can run, the zip is downloaded
 *      quietly; the updater checks its SHA-256 before unpacking.
 *   3. It is NOT applied while anyone could be in the middle of something.
 *      It takes over when MONEVA starts from closed - before anything is on
 *      screen - or when someone comes back after 10 minutes or more away.
 *      A quick trip to the bank app never restarts the app mid-entry.
 *   4. If the new bundle fails to start, the updater rolls back by itself.
 *
 * WHY THE APP DECIDES THE MOMENT, NOT THE PLUGIN. The plugin's own
 * "apply after N minutes in the background" was tried first (1.0.8). On a
 * Galaxy A33, swiping the app away destroys the activity but keeps the
 * process; on the next start the plugin read the background timer as zero,
 * counted the wait as over, and then reloaded the app the very next time it
 * was left - two seconds in another app was enough. So the plugin is never
 * told about a waiting bundle (no next(), no delays); this file applies it
 * itself, with set(), at the two safe moments above.
 */

/* The manifest is a few hundred bytes from Cloudflare's edge, so checking is
   nearly free: every start from closed, and on returns at most every 30 min. */
const CHECK_EVERY_MS = 30 * 60 * 1000;
const APPLY_AFTER_AWAY_MS = 10 * 60 * 1000;
const LAST_CHECK_KEY = 'moneva_live_last_check';
const PENDING_KEY = 'moneva_live_pending';
const SEEN_VERSION_KEY = 'moneva_live_seen_version';
const NOTES_KEY = 'moneva_live_notes';

const isNative = () => Capacitor.isNativePlatform();

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
const forget = (key: string) => { try { localStorage.removeItem(key); } catch { /* private mode */ } };

interface Pending { id: string; version: string }

const readPending = (): Pending | null => {
  try {
    const p = JSON.parse(read(PENDING_KEY) || 'null') as Pending | null;
    return p && typeof p.id === 'string' && typeof p.version === 'string' ? p : null;
  } catch {
    return null;
  }
};

/**
 * Tells the updater this bundle started. Must run early on every launch:
 * a bundle that never says so within 10 seconds is rolled back.
 */
export const markAppReady = (): void => {
  if (!isNative()) return;
  void CapacitorUpdater.notifyAppReady().catch(() => {});
};

/** Whether a downloaded bundle is waiting - cheap, synchronous, for startup. */
export const hasPendingUpdate = (): boolean => {
  if (!isNative()) return false;
  const p = readPending();
  return !!p && versionCodeOf(p.version) > versionCodeOf(currentVersionName());
};

/**
 * Switches to the waiting bundle now. Resolves false if there is nothing to
 * switch to; when it works, the page reloads into the new bundle and this
 * never resolves at all.
 */
export const applyPendingUpdate = async (): Promise<boolean> => {
  if (!hasPendingUpdate()) {
    forget(PENDING_KEY);
    return false;
  }
  const pending = readPending()!;
  try {
    const { bundles } = await CapacitorUpdater.list();
    const bundle = bundles.find((b) => b.id === pending.id && b.status !== 'error');
    if (!bundle) {
      forget(PENDING_KEY);
      return false;
    }
    await CapacitorUpdater.set({ id: bundle.id });
    return true;
  } catch {
    forget(PENDING_KEY);
    return false;
  }
};

let running = false;

/** Looks for a newer bundle and downloads it. Never throws, never interrupts. */
export const checkForLiveUpdate = async ({ force = false }: { force?: boolean } = {}): Promise<void> => {
  if (!isNative() || running) return;
  const last = Number(read(LAST_CHECK_KEY) || 0);
  if (!force && Date.now() - last < CHECK_EVERY_MS) return;
  running = true;
  try {
    const manifest = await fetchManifest();
    if (!manifest) return;
    write(LAST_CHECK_KEY, String(Date.now()));

    const nativeCode = Number((await App.getInfo()).build) || 0;
    if (!shouldDownload(manifest, { bundleVersion: currentVersionName(), nativeCode })) return;
    const waiting = readPending();
    if (waiting && versionCodeOf(waiting.version) >= versionCodeOf(manifest.version)) return;

    // Already fetched on an earlier check: reuse it rather than re-download.
    const { bundles } = await CapacitorUpdater.list();
    let bundle = bundles.find((b) => b.version === manifest.version && b.status !== 'error');
    if (!bundle) {
      bundle = await CapacitorUpdater.download({ url: manifest.url, version: manifest.version, checksum: manifest.sha256 });
    }
    write(PENDING_KEY, JSON.stringify({ id: bundle.id, version: manifest.version }));
    write(NOTES_KEY, JSON.stringify({ version: manifest.version, notes: manifest.notes }));
  } catch {
    // Offline, a half download, a full disk: try again next time.
  } finally {
    running = false;
  }
};

/**
 * One line about what changed, the first time a new bundle runs - or null.
 * The first launch of a fresh install says nothing: there is no "before".
 */
export const takeUpdateNote = (): string | null => {
  const now = currentVersionName();
  const seen = read(SEEN_VERSION_KEY);
  write(SEEN_VERSION_KEY, now);
  if (!seen || seen === now) return null;
  try {
    const stored = JSON.parse(read(NOTES_KEY) || 'null') as { version?: string; notes?: string } | null;
    if (stored?.version === now && stored.notes) return `Updated to ${now}: ${stored.notes}`;
  } catch { /* fall through */ }
  return `MONEVA updated to ${now}.`;
};

/**
 * Checks now; on every return to the app, either switches to a waiting
 * bundle (after 10+ minutes away) or checks again.
 */
export const startLiveUpdates = (): void => {
  if (!isNative()) return;
  // A start from closed always checks, whatever the last check was.
  void checkForLiveUpdate({ force: true });

  let leftAt = 0;
  void App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) {
      leftAt = Date.now();
      return;
    }
    const away = leftAt ? Date.now() - leftAt : 0;
    leftAt = 0;
    if (away >= APPLY_AFTER_AWAY_MS && hasPendingUpdate()) {
      void applyPendingUpdate();
      return;
    }
    void checkForLiveUpdate();
  });
};
