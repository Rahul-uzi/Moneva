/**
 * One button that takes a new build all the way onto the phone.
 *
 * MONEVA is installed from a website, so nothing updates it. The app could
 * already NOTICE a new version and offer a link, but a link means a browser,
 * then a downloads folder, then a file manager - and most people stop
 * somewhere in the middle, which is the same as never updating at all.
 *
 * So the button does the work instead: it asks the server what is newest,
 * downloads it, and hands it to Android's installer. What it cannot do is
 * install silently - the OS reserves that for system apps, and rightly, since
 * an app that could replace itself unasked could replace itself with anything.
 * The user taps Install once. Everything either side of that tap is automatic,
 * and after it Android restarts MONEVA on the new build.
 *
 * The button's LABEL is the feature as much as the download is: one control
 * that reads "Check for updates" when there is nothing to do and "Update to
 * 1.0.1" when there is. Which is why the label is a pure function of state
 * down at the bottom of this file, and tested as one.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { LatestVersion } from './updateCheck';
import { checkForUpdate } from './updateCheck';

interface ProgressEvent {
  percent: number;
  bytes: number;
  total: number;
}

interface DownloadResult {
  path: string;
  bytes: number;
  versionName: string;
  versionCode: number;
}

export interface UpdaterStatus {
  canInstall: boolean;
  needsPermission: boolean;
  versionName: string;
  versionCode: number;
}

interface AppUpdaterPlugin {
  getStatus(): Promise<UpdaterStatus>;
  requestInstallPermission(): Promise<{ granted: boolean; opened?: boolean }>;
  download(options: { url: string }): Promise<DownloadResult>;
  install(options: { path: string }): Promise<{ opened: boolean }>;
  addListener(
    event: 'downloadProgress',
    fn: (e: ProgressEvent) => void,
  ): Promise<{ remove: () => void }>;
}

const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');

/**
 * Where the button is in its journey.
 *
 * A single union rather than a handful of booleans, because the combinations
 * a set of booleans allows are mostly nonsense - checking AND downloading,
 * ready AND failed - and every one of them would need a rule somewhere to say
 * which wins.
 */
export type UpdateState =
  /** Nothing asked for yet. The resting state, and what the button starts as. */
  | { stage: 'idle' }
  | { stage: 'checking' }
  /** Asked, and there is nothing newer. Carries the version so it can say so. */
  | { stage: 'current'; version: string }
  | { stage: 'available'; latest: LatestVersion }
  /** Found one, but Android has not been allowed to install from us yet. */
  | { stage: 'blocked'; latest: LatestVersion }
  | { stage: 'downloading'; latest: LatestVersion; percent: number }
  /** On the phone and verified. One tap from installed. */
  | { stage: 'ready'; latest: LatestVersion; path: string }
  | { stage: 'failed'; message: string };

/** The message an unknown failure should carry, rather than "[object Object]". */
const readMessage = (err: unknown, fallback: string): string => {
  if (typeof err === 'string' && err.trim()) return err;
  const m = (err as { message?: unknown } | null)?.message;
  return typeof m === 'string' && m.trim() ? m : fallback;
};

/** Whether this build can update itself at all. The web app is never stale. */
export const canSelfUpdate = (): boolean => Capacitor.isNativePlatform();

export const updaterStatus = async (): Promise<UpdaterStatus | null> => {
  if (!canSelfUpdate()) return null;
  try {
    return await AppUpdater.getStatus();
  } catch {
    return null;
  }
};

export const openInstallPermission = async (): Promise<void> => {
  if (!canSelfUpdate()) return;
  try {
    await AppUpdater.requestInstallPermission();
  } catch {
    /* The screen would not open. The button stays where it is and the user
       can try again; there is nothing useful to say about it. */
  }
};

/**
 * Ask the server, and work out what the button should become.
 *
 * Returns `current` rather than throwing when there is no update, because
 * "you are up to date" is a perfectly good answer to a button press and the
 * one the user gets most of the time.
 */
export const lookForUpdate = async (runningVersion: string): Promise<UpdateState> => {
  try {
    const news = await checkForUpdate();
    if (!news) return { stage: 'current', version: runningVersion };

    const status = await updaterStatus();
    // No download address means the server knows about a release but has not
    // been told where the file is. Saying "update available" and then failing
    // on the download is worse than saying nothing useful can be done yet.
    if (!news.latest.download_url) {
      return { stage: 'failed', message: 'A new version exists, but no download has been published yet.' };
    }
    if (status && status.needsPermission) {
      return { stage: 'blocked', latest: news.latest };
    }
    return { stage: 'available', latest: news.latest };
  } catch (err) {
    return { stage: 'failed', message: readMessage(err, 'Could not reach the update server.') };
  }
};

/**
 * Fetch the build, reporting progress as it goes.
 *
 * `onProgress` exists because a three-megabyte download on a slow connection
 * is long enough that a button reading only "Downloading" looks like a button
 * that has hung.
 */
export const downloadUpdate = async (
  latest: LatestVersion,
  onProgress: (percent: number) => void,
): Promise<UpdateState> => {
  let listener: { remove: () => void } | null = null;
  try {
    listener = await AppUpdater.addListener('downloadProgress', (e) => {
      // Clamped: a server that reports a wrong content length must not be
      // able to drive the progress bar past its own end.
      onProgress(Math.max(0, Math.min(100, Math.round(e.percent))));
    });
    const result = await AppUpdater.download({ url: latest.download_url });
    return { stage: 'ready', latest, path: result.path };
  } catch (err) {
    return { stage: 'failed', message: readMessage(err, 'The update could not be downloaded.') };
  } finally {
    // Always removed. A listener left behind survives the component and would
    // drive a progress bar that is no longer on screen.
    try { listener?.remove(); } catch { /* already gone */ }
  }
};

/**
 * Hand it to Android.
 *
 * Success here means the installer OPENED, not that anything was installed -
 * the user can still decline, and no callback tells us so. If they accept,
 * this process is stopped mid-sentence and the new build starts when they
 * next open the app, which is why nothing here waits for a result.
 */
export const installUpdate = async (path: string): Promise<UpdateState | null> => {
  try {
    await AppUpdater.install({ path });
    return null;
  } catch (err) {
    return { stage: 'failed', message: readMessage(err, 'Android would not open the installer.') };
  }
};

/**
 * What the button says.
 *
 * Pure, and separated from everything above on purpose: this is the part of
 * the feature a person actually experiences, it has one line per state, and it
 * can be checked without a phone, a server or a download.
 */
export const updateButtonLabel = (state: UpdateState): string => {
  switch (state.stage) {
    case 'checking':
      return 'Checking...';
    case 'current':
      return 'Check again';
    case 'available':
      return `Update to ${state.latest.version_name}`;
    case 'blocked':
      return 'Allow updates';
    case 'downloading':
      // The number is the point. "Downloading" alone is indistinguishable
      // from a stuck button.
      return `Downloading ${state.percent}%`;
    case 'ready':
      return 'Install now';
    case 'failed':
      return 'Try again';
    case 'idle':
    default:
      return 'Check for updates';
  }
};

/** Whether pressing it would do anything. */
export const updateButtonBusy = (state: UpdateState): boolean =>
  state.stage === 'checking' || state.stage === 'downloading';

/**
 * The line under the button.
 *
 * Null when the label already says everything - a second line repeating the
 * button is noise, and this row sits among a dozen others.
 */
export const updateButtonHint = (state: UpdateState, runningVersion: string): string | null => {
  switch (state.stage) {
    case 'current':
      return `You are on ${runningVersion}, which is the newest.`;
    case 'available':
      return state.latest.notes || 'A newer version is ready to download.';
    case 'blocked':
      return 'Android needs your permission for MONEVA to install its own updates. '
        + 'This opens that setting.';
    case 'downloading':
      return 'Keep this screen open until it finishes.';
    case 'ready':
      return `Version ${state.latest.version_name} is on your phone. `
        + 'Android will ask you to confirm, then reopen MONEVA.';
    case 'failed':
      return state.message;
    case 'checking':
      return null;
    case 'idle':
    default:
      return `You are on version ${runningVersion}.`;
  }
};
