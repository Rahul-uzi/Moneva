import { describe, it, expect } from 'vitest';
import { versionCodeOf } from './updateCheck';
import envProduction from '../../.env.production?raw';
import envExample from '../../.env.example?raw';
import variablesGradle from '../../android/variables.gradle?raw';

/*
 * Read through Vite's `?raw` rather than node:fs. This is a browser-targeted
 * project - its tsconfig has no Node types - so `readFileSync` here failed
 * `tsc -b`, and the build script is `tsc -b && vite build`. The APK that came
 * out of that run was built from the PREVIOUS dist, with none of these
 * changes in it, and reported success at every step after the failure.
 */

/**
 * The app's version is written down twice, and the two must agree.
 *
 * `android/variables.gradle` sets what ANDROID believes - the versionCode it
 * compares when deciding whether an APK is an upgrade, and the versionName in
 * the system's app list. `.env.production` sets what the APP believes, via
 * VITE_APP_VERSION: the number on the settings screen, the one attached to
 * crash reports, and - since the update button shipped - the one compared
 * against the server to decide whether a newer build exists.
 *
 * THE FAILURE THIS CATCHES. Bump the gradle file alone and the phone installs
 * 1.0.1 while the app still calls itself 1.0.0. The update check then compares
 * the server's 10001 against its own 10000, finds a newer version, downloads
 * it, and Android refuses it as already installed - every time it is asked,
 * for ever. The app would insist an update is available and be unable to
 * apply it, which is a far more confusing bug than a wrong number on a screen.
 *
 * It is exactly the kind of drift nothing notices: both files are correct on
 * their own terms, nothing fails to build, and the symptom appears days later
 * on somebody else's phone. So it is asserted here, where a bump that forgets
 * half the job fails in the terminal.
 *
 * `.env.production` is the one checked because that is what a release build
 * loads. The untracked `.env` is a developer's local file and may legitimately
 * say something else.
 */

const envVersion = (): string => {
  const line = /^VITE_APP_VERSION=(.+)$/m.exec(envProduction);
  if (!line) throw new Error('.env.production has no VITE_APP_VERSION');
  return line[1].trim();
};

const gradle = (): { name: string; code: number } => {
  const name = /monevaVersionName\s*=\s*'([^']+)'/.exec(variablesGradle);
  const code = /monevaVersionCode\s*=\s*(\d+)/.exec(variablesGradle);
  if (!name || !code) throw new Error('variables.gradle has no version');
  return { name: name[1].trim(), code: parseInt(code[1], 10) };
};

describe('the two places the version is written', () => {
  it('say the same thing', () => {
    expect(envVersion()).toBe(gradle().name);
  });

  it('carry a version code that matches the name', () => {
    /*
     * The scheme is MAJOR*10000 + MINOR*100 + PATCH, and the app derives the
     * running code from the NAME rather than being told it separately. So a
     * hand-written code that does not follow the scheme would make the app
     * compare a number Android never assigned.
     */
    const { name, code } = gradle();
    expect(code).toBe(versionCodeOf(name));
  });

  it('is a three-part version, which is what the scheme assumes', () => {
    // versionCodeOf treats a missing part as zero, so "1.1" would quietly
    // become 10100 and collide with a later "1.1.0".
    expect(envVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('keeps the example file honest too', () => {
    // It is what a new checkout copies to .env, so a stale version there
    // hands the next person a build that misreports itself from the start.
    const example = /^VITE_APP_VERSION=(.+)$/m.exec(envExample);
    expect(example?.[1].trim()).toBe(gradle().name);
  });
});
