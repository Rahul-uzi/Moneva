import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { currentVersionName } from './updateCheck';
import { verifyManifest, shouldDownload } from '../utils/liveUpdateManifest';

/**
 * Live updates: new screens and fixes without an APK.
 *
 * The APK is a native shell around a web bundle - every screen, colour and
 * line of logic. A new bundle can therefore be shipped on its own:
 *
 *   1. On launch and on return to the app (at most every few hours), the
 *      signed manifest on the website is read and verified.
 *   2. If it names a newer bundle this shell can run, the zip is downloaded
 *      quietly; the updater checks its SHA-256 before unpacking.
 *   3. It is queued, never applied mid-use: it takes over the next time
 *      MONEVA starts, or after it has sat in the background for 10 minutes.
 *      Someone who switches to their bank app to check an amount comes back
 *      to exactly what they left - not to a restarted app and a lost entry.
 *   4. If the new bundle fails to start, the updater rolls back by itself.
 *
 * Native changes (permissions, plugins, the icon) still need an APK; the
 * manifest's min_native_code keeps a bundle off shells too old for it.
 */

const MANIFEST_URL = 'https://moneva.monev.workers.dev/updates/manifest.json';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const APPLY_AFTER_BACKGROUND_MS = 10 * 60 * 1000;
const LAST_CHECK_KEY = 'moneva_live_last_check';
const SEEN_VERSION_KEY = 'moneva_live_seen_version';
const NOTES_KEY = 'moneva_live_notes';

const isNative = () => Capacitor.isNativePlatform();

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };

/**
 * Tells the updater this bundle started. Must run early on every launch:
 * a bundle that never says so within 10 seconds is rolled back.
 */
export const markAppReady = (): void => {
  if (!isNative()) return;
  void CapacitorUpdater.notifyAppReady().catch(() => {});
};

let running = false;

/** Looks for a newer bundle and queues it. Never throws, never interrupts. */
export const checkForLiveUpdate = async ({ force = false }: { force?: boolean } = {}): Promise<void> => {
  if (!isNative() || running) return;
  const last = Number(read(LAST_CHECK_KEY) || 0);
  if (!force && Date.now() - last < CHECK_EVERY_MS) return;
  running = true;
  try {
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const manifest = await verifyManifest(await res.json());
    write(LAST_CHECK_KEY, String(Date.now()));
    if (!manifest) return;

    const nativeCode = Number((await App.getInfo()).build) || 0;
    if (!shouldDownload(manifest, { bundleVersion: currentVersionName(), nativeCode })) return;

    // Already fetched on an earlier check: queue it again rather than re-download.
    const { bundles } = await CapacitorUpdater.list();
    let bundle = bundles.find((b) => b.version === manifest.version && b.status !== 'error');
    if (!bundle) {
      bundle = await CapacitorUpdater.download({ url: manifest.url, version: manifest.version, checksum: manifest.sha256 });
    }
    await CapacitorUpdater.next({ id: bundle.id });
    await CapacitorUpdater.setMultiDelay({
      delayConditions: [{ kind: 'background', value: String(APPLY_AFTER_BACKGROUND_MS) }],
    });
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

/** Checks now, and again whenever the app comes back to the front. */
export const startLiveUpdates = (): void => {
  if (!isNative()) return;
  void checkForLiveUpdate();
  void App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void checkForLiveUpdate();
  });
};
