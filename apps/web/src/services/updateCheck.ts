/**
 * Noticing that a newer build exists.
 *
 * MONEVA is installed from a website, so nothing updates it. Without this,
 * somebody who installed version 1.0.0 runs 1.0.0 until they happen to visit
 * the site again and happen to notice a newer file - which is to say, never.
 * Every fix made after they installed is invisible to them, including the ones
 * that matter.
 *
 * That single fact is most of what makes a sideloaded app feel like a hobby
 * project rather than a product. An app that tells you it has been improved is
 * an app that is being looked after.
 *
 * WHAT THIS IS NOT. It does not download or install anything. Android will not
 * let a web view install an APK, and it should not: the user opens the link,
 * sees the download, and installs it themselves. This only tells them there is
 * something to install, and what changed.
 */

import { Capacitor } from '@capacitor/core';
import { apiClient } from './apiClient';

export interface LatestVersion {
  version_code: number;
  version_name: string;
  download_url: string;
  notes: string;
  mandatory: boolean;
}

export interface UpdateNews {
  /** The version you are running. */
  current: number;
  latest: LatestVersion;
}

/**
 * The build number this APK was compiled with.
 *
 * Derived from the version NAME rather than carried separately, because a
 * second source would drift: the name is what the user sees and what the
 * release notes talk about, so it is the one that gets updated. The scheme is
 * the same one build.gradle uses - MAJOR*10000 + MINOR*100 + PATCH - so 1.2.3
 * is 10203 on both sides.
 */
export const versionCodeOf = (name: string): number => {
  const parts = String(name).trim().split('.').map((n) => parseInt(n, 10));
  const [major, minor, patch] = [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  return major * 10000 + minor * 100 + patch;
};

export const currentVersionName = (): string =>
  (import.meta.env?.VITE_APP_VERSION as string | undefined) ?? '0.0.0';

/** How long to wait before mentioning a version the user already dismissed. */
const REMIND_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

const DISMISSED_KEY = 'moneva_update_dismissed';

interface Dismissal {
  code: number;
  at: number;
}

const readDismissal = (): Dismissal | null => {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as Dismissal) : null;
  } catch {
    return null;
  }
};

/**
 * Remember that this version was waved away.
 *
 * Not forever, and not silently for a mandatory one. Somebody who dismissed an
 * update on a train has not decided never to update; asking again in three
 * days is the difference between a reminder and a nag.
 */
export const dismissUpdate = (code: number): void => {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    /* Unwritable storage means it asks again next launch, which is the safe
       way for this to fail - a missed update is worse than a repeated prompt. */
  }
};

export const wasRecentlyDismissed = (code: number, now = Date.now()): boolean => {
  const d = readDismissal();
  if (!d || d.code !== code) return false;
  return now - d.at < REMIND_AFTER_MS;
};

/**
 * Ask the server what the newest build is.
 *
 * Returns null whenever there is nothing worth saying - which is most of the
 * time, and covers: not on a phone, the server has not been told about any
 * release, the running build is current or newer, or the check simply failed.
 * A failed check must be silent: this runs on launch, and an app that
 * complains because it could not reach a version endpoint is worse than one
 * that never checked.
 */
export const checkForUpdate = async (): Promise<UpdateNews | null> => {
  // Only the Android build is installed from a file. The web app is whatever
  // the server last served, so it is never out of date.
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const res = await apiClient.get<LatestVersion>('/app/version');
    const latest = res.data;
    if (!latest || !latest.version_code) return null;

    const current = versionCodeOf(currentVersionName());
    // Newer OR EQUAL is not news. `>` matters: a developer running a build
    // ahead of the published one should not be told to downgrade.
    if (latest.version_code <= current) return null;

    return { current, latest };
  } catch {
    return null;
  }
};
