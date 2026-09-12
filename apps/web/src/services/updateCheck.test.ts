// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  versionCodeOf,
  dismissUpdate,
  wasRecentlyDismissed,
} from './updateCheck';

/**
 * Knowing you are out of date.
 *
 * The failure to guard against is not a missed prompt - it is a WRONG one. An
 * app installed from a website has no store to correct it, so a version
 * comparison that reads backwards tells people to "update" to a build older
 * than the one they are running, and there is nothing to stop them.
 *
 * The second failure is a prompt that will not go away. An update people
 * dismiss on every launch is one they stop reading, which costs exactly the
 * release where it mattered.
 */

describe('turning a version name into a number to compare', () => {
  it('follows the same scheme build.gradle uses', () => {
    // MAJOR * 10000 + MINOR * 100 + PATCH, so the code reads as the name.
    expect(versionCodeOf('1.0.0')).toBe(10000);
    expect(versionCodeOf('1.2.3')).toBe(10203);
    expect(versionCodeOf('2.0.0')).toBe(20000);
  });

  it('orders releases the way people expect', () => {
    // The one that catches a naive string compare: "1.10" sorts before "1.9"
    // alphabetically, and would silently stop offering every later release.
    expect(versionCodeOf('1.10.0')).toBeGreaterThan(versionCodeOf('1.9.0'));
    expect(versionCodeOf('1.0.10')).toBeGreaterThan(versionCodeOf('1.0.9'));
    expect(versionCodeOf('2.0.0')).toBeGreaterThan(versionCodeOf('1.99.99'));
  });

  it('survives a half-written version', () => {
    // These come from environment variables a human types during a release.
    expect(versionCodeOf('1.0')).toBe(10000);
    expect(versionCodeOf('2')).toBe(20000);
    expect(versionCodeOf('')).toBe(0);
    expect(versionCodeOf('not a version')).toBe(0);
  });

  it('treats a missing version as the oldest, not the newest', () => {
    /**
     * The direction matters. `checkForUpdate` only offers an update when the
     * server's code is GREATER than the running one - so an unparsable local
     * version becoming 0 means the app is told it is out of date, which is
     * recoverable. The reverse would silence the prompt permanently.
     */
    expect(versionCodeOf('garbage')).toBeLessThan(versionCodeOf('1.0.0'));
  });
});

describe('dismissing an update', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('stops asking about the version that was waved away', () => {
    dismissUpdate(10203);
    expect(wasRecentlyDismissed(10203)).toBe(true);
  });

  it('still asks about the NEXT version', () => {
    // Dismissing 1.2.3 is not a decision about 1.2.4. A reporter that treated
    // it as one would go quiet forever after a single dismissal.
    dismissUpdate(10203);
    expect(wasRecentlyDismissed(10204)).toBe(false);
  });

  it('asks again after a few days', () => {
    /**
     * Dismissing on a train is not deciding never to update. Coming back in
     * three days is a reminder; coming back every launch is a nag, and the
     * difference decides whether the prompt still works on the day a release
     * actually matters.
     */
    /**
     * The clock is pinned BEFORE dismissing, and that is the whole test.
     *
     * `dismissUpdate` stamps Date.now(). The first version of this test
     * hardcoded `now` to the day it was written and then compared against a
     * real-clock stamp - so it passed that day and failed the next, once the
     * real date had drifted past the constant. A test that only passes on
     * the date it was written is measuring the calendar, not the code.
     */
    const now = Date.UTC(2026, 8, 11, 12, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    dismissUpdate(10203);
    expect(wasRecentlyDismissed(10203, now + 2 * 24 * 3600_000)).toBe(true);
    expect(wasRecentlyDismissed(10203, now + 4 * 24 * 3600_000)).toBe(false);
  });

  it('asks when nothing was ever dismissed', () => {
    expect(wasRecentlyDismissed(10000)).toBe(false);
  });
});
