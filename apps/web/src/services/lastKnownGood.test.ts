import { describe, it, expect } from 'vitest';
import { describeAge, isReachabilityFailure, isWorthKeeping } from './lastKnownGood';

/**
 * When it is right to show someone yesterday's numbers.
 *
 * The two ways this goes wrong are not symmetric.
 *
 * Failing to fall back leaves the app blank for the 43 seconds the free-tier
 * server takes to wake, which is annoying and obvious - people complain, and
 * the complaint is easy to act on.
 *
 * Falling back when we should not is silent. A session that has ended, shown a
 * cached balance instead of an authorisation error, leaves someone reading
 * figures while believing they are signed in. Nothing on screen says otherwise
 * and there is no moment at which they find out.
 *
 * So the tests below spend most of their attention on refusing.
 */

describe('which failures a saved copy may answer', () => {
  it('answers a request that got no response at all', () => {
    // The cold-start case: the socket is open, the server is waking, nothing
    // comes back before the client gives up.
    expect(isReachabilityFailure(undefined)).toBe(true);
  });

  it('answers a timeout', () => {
    expect(isReachabilityFailure(undefined, 'ECONNABORTED')).toBe(true);
    expect(isReachabilityFailure(undefined, 'ETIMEDOUT')).toBe(true);
  });

  it('answers a server that is unwell', () => {
    expect(isReachabilityFailure(500)).toBe(true);
    expect(isReachabilityFailure(502)).toBe(true);
    expect(isReachabilityFailure(503)).toBe(true);
  });

  it('never answers an ended session', () => {
    /**
     * The one that matters. A 401 means the session is over; showing saved
     * figures instead would hide that, and the person would go on reading
     * balances believing they were signed in. The error has to reach them.
     */
    expect(isReachabilityFailure(401)).toBe(false);
    expect(isReachabilityFailure(403)).toBe(false);
  });

  it('never answers a real answer', () => {
    // A 404 IS an answer - the thing is not there. Substituting an older copy
    // would resurrect something the server has said is gone.
    expect(isReachabilityFailure(404)).toBe(false);
    expect(isReachabilityFailure(400)).toBe(false);
    expect(isReachabilityFailure(409)).toBe(false);
    expect(isReachabilityFailure(422)).toBe(false);
    expect(isReachabilityFailure(429)).toBe(false);
  });
});

describe('what is worth saving', () => {
  it('keeps the screens that would otherwise open blank', () => {
    expect(isWorthKeeping('/finance/summary')).toBe(true);
    expect(isWorthKeeping('/accounts')).toBe(true);
    expect(isWorthKeeping('/transactions')).toBe(true);
    expect(isWorthKeeping('/budgets')).toBe(true);
    expect(isWorthKeeping('/goals')).toBe(true);
    expect(isWorthKeeping('/bills')).toBe(true);
  });

  it('never keeps who is signed in', () => {
    /**
     * `/auth/me` decides what the app believes about the current user. A saved
     * copy could outlive the session it describes, and every scoping decision
     * in the app - including which saved figures belong to whom - is made from
     * it. Stale here poisons everything downstream.
     */
    expect(isWorthKeeping('/auth/me')).toBe(false);
    expect(isWorthKeeping('/auth/login')).toBe(false);
  });

  it('does not keep a live count', () => {
    // Restoring an hour-old unread badge is noise, not help.
    expect(isWorthKeeping('/notifications/unread-count')).toBe(false);
  });

  it('does not treat an import as a read worth saving', () => {
    // `/transactions` is kept; `/transactions/import` is a write path and must
    // not be caught by the same prefix.
    expect(isWorthKeeping('/transactions/import')).toBe(false);
    expect(isWorthKeeping('/transactions/import/sheet')).toBe(false);
  });
});

describe('saying how old the figures are', () => {
  const NOW = Date.UTC(2026, 8, 10, 12, 0, 0);
  const ago = (ms: number) => describeAge(NOW - ms, NOW);

  it('is vague only when vagueness is honest', () => {
    expect(ago(5_000)).toBe('a moment ago');
    expect(ago(60_000)).toBe('a moment ago');
  });

  it('counts minutes once a moment stops being true', () => {
    expect(ago(5 * 60_000)).toBe('5 minutes ago');
    expect(ago(1.6 * 60_000)).toBe('1 minute ago');
  });

  it('counts hours', () => {
    expect(ago(3 * 3600_000)).toBe('3 hours ago');
    expect(ago(1 * 3600_000)).toBe('1 hour ago');
  });

  it('names yesterday as yesterday', () => {
    expect(ago(26 * 3600_000)).toBe('yesterday');
  });

  it('never calls a day-old balance a moment', () => {
    /**
     * The failure this whole label exists to prevent. A balance from a minute
     * ago and one from last week lead to different decisions, and a banner
     * that blurred them would be a politer version of the lie this replaced.
     */
    for (const days of [2, 7, 29]) {
      expect(ago(days * 24 * 3600_000)).toBe(`${days} days ago`);
    }
    expect(ago(60 * 24 * 3600_000)).toBe('2 months ago');
  });

  it('does not go backwards when the clock does', () => {
    // Phone clocks are wrong, and a saved-at in the future would otherwise
    // produce a negative age and a nonsense label.
    expect(describeAge(NOW + 60_000, NOW)).toBe('a moment ago');
  });
});
