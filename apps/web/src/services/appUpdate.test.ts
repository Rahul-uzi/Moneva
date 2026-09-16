import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  lookForUpdate,
  updateButtonBusy,
  updateButtonHint,
  updateButtonLabel,
  type UpdateState,
} from './appUpdate';
import type { LatestVersion } from './updateCheck';

const checkForUpdate = vi.fn();
const getStatus = vi.fn();

vi.mock('./updateCheck', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./updateCheck')>();
  return { ...actual, checkForUpdate: (...a: unknown[]) => checkForUpdate(...a) };
});

// The plugin is a native bridge; on a desktop test runner it resolves to a
// stub that throws. Standing in for it lets the DECISIONS around the download
// be tested, which is where the mistakes are - the download itself is a phone.
vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: { ...actual.Capacitor, isNativePlatform: () => true },
    registerPlugin: () => ({ getStatus: (...a: unknown[]) => getStatus(...a) }),
  };
});

/**
 * One button, six jobs.
 *
 * The feature is not really "download an APK" - it is that a single control
 * always says what pressing it will do next, so nobody has to work out which
 * of three buttons applies to them. That makes the LABEL the part worth
 * testing hardest: it is what the person reads, and a label that disagrees
 * with what the button does is worse than no button.
 *
 * The download and the install cannot be tested here - they are a phone, a
 * network and Android's installer. The decisions around them can, and those
 * are where the mistakes live.
 */

const LATEST: LatestVersion = {
  version_code: 10001,
  version_name: '1.0.1',
  download_url: 'https://moneva.example/app-release.apk',
  notes: 'Reads Canara Bank alerts.',
  mandatory: false,
};

describe('what the button says', () => {
  it('offers a check before anything has been asked', () => {
    expect(updateButtonLabel({ stage: 'idle' })).toBe('Check for updates');
  });

  it('names the version it would install', () => {
    /*
     * "Update available" tells you nothing you can act on. The version number
     * is what lets somebody who already knows what 1.0.1 fixes decide.
     */
    expect(updateButtonLabel({ stage: 'available', latest: LATEST }))
      .toBe('Update to 1.0.1');
  });

  it('counts the download rather than just saying it is busy', () => {
    // A label reading only "Downloading" is indistinguishable from a button
    // that has hung, and a 3 MB file on a slow connection looks hung for a
    // long time.
    expect(updateButtonLabel({ stage: 'downloading', latest: LATEST, percent: 0 }))
      .toBe('Downloading 0%');
    expect(updateButtonLabel({ stage: 'downloading', latest: LATEST, percent: 64 }))
      .toBe('Downloading 64%');
  });

  it('turns into an install once the file is on the phone', () => {
    expect(updateButtonLabel({ stage: 'ready', latest: LATEST, path: '/tmp/a.apk' }))
      .toBe('Install now');
  });

  it('asks for permission in the one case Android requires it', () => {
    expect(updateButtonLabel({ stage: 'blocked', latest: LATEST })).toBe('Allow updates');
  });

  it('offers another go after a failure, not a dead end', () => {
    expect(updateButtonLabel({ stage: 'failed', message: 'No connection.' }))
      .toBe('Try again');
  });

  it('stays useful when there is nothing to do', () => {
    // "Check for updates" again would read as though the first press did
    // nothing. "Check again" says it worked and this is a repeat.
    expect(updateButtonLabel({ stage: 'current', version: '1.0.0' })).toBe('Check again');
  });
});

describe('when the button is inert', () => {
  it('cannot be pressed while it is working', () => {
    expect(updateButtonBusy({ stage: 'checking' })).toBe(true);
    expect(updateButtonBusy({ stage: 'downloading', latest: LATEST, percent: 10 })).toBe(true);
  });

  it('can be pressed in every state that has a next step', () => {
    /*
     * The half that matters. A guard that returned true too often would
     * silently strand the user on a button that looks live and does nothing -
     * the same bug as no button, but harder to notice.
     */
    const pressable: UpdateState[] = [
      { stage: 'idle' },
      { stage: 'current', version: '1.0.0' },
      { stage: 'available', latest: LATEST },
      { stage: 'blocked', latest: LATEST },
      { stage: 'ready', latest: LATEST, path: '/tmp/a.apk' },
      { stage: 'failed', message: 'Nope.' },
    ];
    for (const state of pressable) {
      expect(updateButtonBusy(state), state.stage).toBe(false);
    }
  });
});

describe('the line under the button', () => {
  it('says what a new version changes', () => {
    // The release note is the reason somebody takes an update rather than
    // dismissing it. Without it "a new version exists" is an interruption.
    expect(updateButtonHint({ stage: 'available', latest: LATEST }, '1.0.0'))
      .toBe('Reads Canara Bank alerts.');
  });

  it('still says something useful when a release has no notes', () => {
    const quiet = { ...LATEST, notes: '' };
    const hint = updateButtonHint({ stage: 'available', latest: quiet }, '1.0.0');
    expect(hint).toBeTruthy();
    expect(hint).not.toBe('');
  });

  it('warns that Android will ask before it asks', () => {
    /*
     * The one step that cannot be automated. A system dialog nobody was
     * warned about reads as the app doing something behind their back, which
     * is the opposite of what an update prompt needs to feel like.
     */
    const hint = updateButtonHint({ stage: 'ready', latest: LATEST, path: '/a.apk' }, '1.0.0');
    expect(hint).toMatch(/confirm/i);
    expect(hint).toMatch(/1\.0\.1/);
  });

  it('gives the failure, not a generic apology', () => {
    expect(updateButtonHint({ stage: 'failed', message: 'The download was cut short.' }, '1.0.0'))
      .toBe('The download was cut short.');
  });

  it('names the running version when there is nothing to report', () => {
    expect(updateButtonHint({ stage: 'idle' }, '1.0.0')).toContain('1.0.0');
    expect(updateButtonHint({ stage: 'current', version: '1.0.0' }, '1.0.0')).toContain('1.0.0');
  });

  it('says nothing at all while a check is in flight', () => {
    // The button already reads "Checking...". A second line saying the same
    // thing is noise on a row that sits among a dozen others.
    expect(updateButtonHint({ stage: 'checking' }, '1.0.0')).toBeNull();
  });
});

describe('deciding what a check found', () => {
  beforeEach(() => {
    checkForUpdate.mockReset();
    getStatus.mockReset();
    getStatus.mockResolvedValue({
      canInstall: true, needsPermission: false, versionName: '1.0.0', versionCode: 10000,
    });
  });

  it('reports being up to date rather than failing', () => {
    // Most presses of this button find nothing, and "you are up to date" is a
    // perfectly good answer - not an error state to be recovered from.
    checkForUpdate.mockResolvedValue(null);
    return expect(lookForUpdate('1.0.0')).resolves.toEqual({
      stage: 'current', version: '1.0.0',
    });
  });

  it('will not promise an update it has no file for', async () => {
    /*
     * The server learns a release exists from environment variables, and the
     * version can be set before the APK is uploaded - the two are separate
     * variables and separate acts. Offering "Update to 1.0.1" then would put
     * the user into a download that fails, which reads as a broken app rather
     * than an unfinished release.
     */
    checkForUpdate.mockResolvedValue({ current: 10000, latest: { ...LATEST, download_url: '' } });
    const state = await lookForUpdate('1.0.0');
    expect(state.stage).toBe('failed');
    expect(state.stage === 'failed' && state.message).toMatch(/no download/i);
  });

  it('asks for permission before downloading, not after', async () => {
    /*
     * Order matters. Downloading three megabytes and only THEN discovering
     * Android will not let us install wastes the data and lands the user on a
     * permission screen with no idea why.
     */
    checkForUpdate.mockResolvedValue({ current: 10000, latest: LATEST });
    getStatus.mockResolvedValue({
      canInstall: false, needsPermission: true, versionName: '1.0.0', versionCode: 10000,
    });
    const state = await lookForUpdate('1.0.0');
    expect(state.stage).toBe('blocked');
  });

  it('offers the update when everything is in place', async () => {
    checkForUpdate.mockResolvedValue({ current: 10000, latest: LATEST });
    const state = await lookForUpdate('1.0.0');
    expect(state).toEqual({ stage: 'available', latest: LATEST });
  });

  it('says what went wrong when the server cannot be reached', async () => {
    checkForUpdate.mockRejectedValue(new Error('Network down'));
    const state = await lookForUpdate('1.0.0');
    expect(state.stage).toBe('failed');
    expect(state.stage === 'failed' && state.message).toBeTruthy();
  });
});
