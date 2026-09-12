import { describe, it, expect } from 'vitest';
import { captureHealth, type CaptureFacts } from './captureHealth';

/**
 * The one capture failure nobody can see.
 *
 * A wrong amount is visible and a wrong payee is visible, but a listener the
 * system has killed produces nothing at all - which looks exactly like a week
 * where you did not spend anything. This is the only thing standing between
 * "capture stopped a month ago" and finding out when the budgets are wrong.
 *
 * The awkward half is that silence really can be innocent, so the tests below
 * check the wording as much as the state: it has to raise the possibility
 * without asserting a fault it cannot actually see.
 */

const NOW = Date.UTC(2026, 8, 20, 12, 0);
const DAY = 86_400_000;
const daysAgo = (n: number) => NOW - n * DAY;

const facts = (over: Partial<CaptureFacts> = {}): CaptureFacts => ({
  supported: true,
  granted: true,
  capturing: true,
  lastKeptAt: daysAgo(0),
  keptCount: 12,
  enabledAt: daysAgo(60),
  connected: true,
  connectedAt: daysAgo(60),
  batteryExempt: true,
  manufacturer: 'google',
  now: NOW,
  ...over,
});

describe('when nothing can arrive at all', () => {
  it('says so plainly when Android has revoked notification access', () => {
    const h = captureHealth(facts({ granted: false }));
    expect(h.state).toBe('blocked');
    expect(h.tone).toBe('bad');
    // The important reassurance: this is not silent data loss, it is a stop.
    expect(h.detail).toMatch(/nothing is arriving at all/i);
  });

  it('treats the user switching it off as a choice, not a fault', () => {
    const h = captureHealth(facts({ capturing: false }));
    expect(h.state).toBe('off');
    expect(h.tone).toBe('ok');
    expect(h.detail).toMatch(/by hand/i);
  });

  it('says nothing at all on the web, where there is no listener', () => {
    expect(captureHealth(facts({ supported: false })).state).toBe('unsupported');
  });
});

describe('while it is working', () => {
  it('is healthy when a payment arrived today', () => {
    const h = captureHealth(facts({ lastKeptAt: daysAgo(0), keptCount: 12 }));
    expect(h.state).toBe('healthy');
    expect(h.detail).toBe('12 payments noticed so far, including today.');
  });

  it('is still healthy after a day or two', () => {
    expect(captureHealth(facts({ lastKeptAt: daysAgo(2) })).state).toBe('healthy');
  });

  it('counts one payment without saying "1 payments"', () => {
    const h = captureHealth(facts({ keptCount: 1, lastKeptAt: daysAgo(1) }));
    expect(h.detail).toMatch(/^1 payment noticed so far/);
    expect(h.detail).toMatch(/1 day ago/);
  });
});

describe('when it goes quiet', () => {
  it('mentions a few days without alarming anyone', () => {
    const h = captureHealth(facts({ lastKeptAt: daysAgo(5) }));
    expect(h.state).toBe('quiet');
    expect(h.tone).toBe('ok');
    // Silence has an innocent explanation and the wording has to offer it.
    expect(h.detail).toMatch(/normal if you have not paid/i);
  });

  it('raises it properly once the silence is longer than real life', () => {
    const h = captureHealth(facts({ lastKeptAt: daysAgo(14) }));
    expect(h.state).toBe('stalled');
    expect(h.tone).toBe('warn');
    expect(h.daysSilent).toBe(14);
    // Conditional, not an accusation - the app cannot see whether they spent.
    expect(h.detail).toMatch(/if you have been paying/i);
    // The remedy it names is the one the app now performs itself. It used to
    // say "notification access", pointing the user at a manual toggle; that
    // toggle is what the reconnect logic does for them.
    expect(h.detail).toMatch(/opening the app/i);
  });
});

describe('the mistake this must not make', () => {
  it('does not report a month of silence the moment capture is switched on', () => {
    // Turned off in July, turned on a minute ago, no payment since. Measuring
    // from the last payment alone would say "stalled" instantly and send the
    // user to fix something that is not broken.
    const h = captureHealth(facts({
      lastKeptAt: daysAgo(45),
      enabledAt: daysAgo(0),
      keptCount: 30,
    }));
    expect(h.state).toBe('healthy');
    expect(h.daysSilent).toBe(0);
  });

  it('still counts silence from the payment when capture has been on longer', () => {
    const h = captureHealth(facts({ lastKeptAt: daysAgo(12), enabledAt: daysAgo(90) }));
    expect(h.state).toBe('stalled');
    expect(h.daysSilent).toBe(12);
  });
});

describe('before the first payment ever arrives', () => {
  it('is patient at first', () => {
    const h = captureHealth(facts({ keptCount: 0, lastKeptAt: 0, enabledAt: daysAgo(1) }));
    expect(h.state).toBe('waiting');
    expect(h.tone).toBe('ok');
    expect(h.detail).toMatch(/should appear here/i);
  });

  it('but says something once a fresh install has seen nothing for ages', () => {
    // Granting the permission and then never receiving anything is the classic
    // shape of a listener that was never actually bound.
    const h = captureHealth(facts({ keptCount: 0, lastKeptAt: 0, enabledAt: daysAgo(12) }));
    expect(h.state).toBe('waiting');
    expect(h.detail).toMatch(/may not be reaching MONEVA/i);
  });
});


describe('when Android has dropped the listener', () => {
  /**
   * The failure that produced this whole change. On a Samsung, an app left
   * unopened for a few days has its process killed to save battery, Android
   * does not reliably rebind the notification listener afterwards, and every
   * payment until the next launch goes unnoticed - with nothing anywhere able
   * to say so. This state is the app SAYING so, from a fact the service
   * reported rather than from silence.
   */
  it('says so as a fact, not a guess', () => {
    const h = captureHealth(facts({ connected: false, connectedAt: daysAgo(1) }));
    expect(h.state).toBe('disconnected');
    expect(h.tone).toBe('bad');
    expect(h.headline).toMatch(/android stopped/i);
  });

  it('outranks a recent payment', () => {
    // A payment came in this morning and the listener died at noon. The
    // silence arithmetic would call this healthy; the fact says otherwise.
    const h = captureHealth(facts({ connected: false, connectedAt: NOW - 3600_000, lastKeptAt: daysAgo(0) }));
    expect(h.state).toBe('disconnected');
  });

  it('names the Samsung setting on a Samsung', () => {
    const h = captureHealth(facts({ connected: false, connectedAt: daysAgo(1), manufacturer: 'samsung' }));
    expect(h.detail).toMatch(/never sleeping apps/i);
  });

  it('does not lecture other phones about Samsung', () => {
    const h = captureHealth(facts({ connected: false, connectedAt: daysAgo(1), manufacturer: 'google' }));
    expect(h.detail).not.toMatch(/samsung/i);
  });

  it('is patient with a listener that has never connected yet', () => {
    /**
     * The guard. Right after capture is switched on, Android has not bound
     * the service yet: connected is false and connectedAt is 0 because the
     * service has never reported anything. That is a first enable, not a
     * disconnect, and flashing "Android stopped the listener" at that moment
     * would be the app crying wolf on every fresh switch-on.
     */
    const h = captureHealth(facts({ connected: false, connectedAt: 0, keptCount: 0, lastKeptAt: 0, enabledAt: NOW - 5000 }));
    expect(h.state).toBe('waiting');
    expect(h.tone).toBe('ok');
  });
});

describe('the battery advisory', () => {
  it('is raised even while healthy, because it is about what will go wrong', () => {
    const h = captureHealth(facts({ batteryExempt: false }));
    expect(h.state).toBe('healthy');
    expect(h.needsBatteryExemption).toBe(true);
  });

  it('is silent once the app is exempt', () => {
    expect(captureHealth(facts({ batteryExempt: true })).needsBatteryExemption).toBe(false);
  });

  it('is not raised when capture is off anyway', () => {
    // A battery kill costs nothing if nothing was meant to be listening.
    expect(captureHealth(facts({ capturing: false, batteryExempt: false })).needsBatteryExemption).toBe(false);
    expect(captureHealth(facts({ granted: false, batteryExempt: false })).needsBatteryExemption).toBe(false);
  });
});

describe('what the stalled advice no longer says', () => {
  it('does not tell the user to toggle notification access by hand', () => {
    // That was the workaround for a failure the app now handles itself. Telling
    // people to do it would mean the reconnect logic is not trusted to work.
    const h = captureHealth(facts({ lastKeptAt: daysAgo(14) }));
    expect(h.state).toBe('stalled');
    expect(h.detail).not.toMatch(/off and on/i);
  });
});
