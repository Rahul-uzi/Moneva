/**
 * Is the app still noticing payments?
 *
 * Every other part of capture fails loudly - a wrong amount is visible, a
 * wrong payee is visible. This one fails in silence: a listener the system
 * killed, a permission revoked in a settings sweep, or a bank that changed its
 * template all look exactly like a quiet week. Nothing appears, and nothing
 * says that nothing appeared.
 *
 * So the app has to say it. The judgement lives here rather than in the screen
 * because it is the part that can be wrong: "capturing = true" is not
 * reassurance, since the switch reports what the user asked for, not what the
 * service is doing.
 *
 * The tone is deliberately careful. Silence has an innocent explanation - a
 * person can genuinely not spend for a week - so this states what it observed
 * and lets the user judge, rather than announcing a fault it cannot see.
 */

export interface CaptureFacts {
  /** Android only; on the web there is nothing to report. */
  supported: boolean;
  /** The OS notification-access permission. */
  granted: boolean;
  /** The app's own switch. */
  capturing: boolean;
  /** Epoch ms of the last alert kept, 0 when none ever was. */
  lastKeptAt: number;
  /** How many alerts have ever been kept. */
  keptCount: number;
  /** Epoch ms when capture was last switched on, 0 when never. */
  enabledAt: number;
  /**
   * Whether Android has the listener BOUND right now. A fact the service
   * reported - not an inference from silence.
   */
  connected: boolean;
  /**
   * Epoch ms when the listener last connected or disconnected; 0 if it has
   * never reported at all. That zero matters: a listener that has never
   * connected is one Android has not got round to yet, which is patience, not
   * a fault.
   */
  connectedAt: number;
  /** Whether the app is exempt from battery optimisation. */
  batteryExempt: boolean;
  /** Lower-cased. Samsung gets phone-specific guidance. */
  manufacturer: string;
  now: number;
}

export type CaptureState =
  | 'unsupported'
  | 'blocked'    // the OS permission is off - nothing can arrive
  | 'off'        // the user switched it off, which is a choice, not a fault
  | 'waiting'    // on, but nothing has arrived yet
  | 'disconnected' // Android has dropped the listener - a fact, not a guess
  | 'healthy'
  | 'quiet'      // a while with nothing; probably fine
  | 'stalled';   // long enough that something is likely wrong

export interface CaptureHealth {
  state: CaptureState;
  tone: 'ok' | 'warn' | 'bad';
  headline: string;
  detail: string;
  /** Whole days since the last alert, or null when none has ever arrived. */
  daysSilent: number | null;
  /**
   * Capture is wanted and permitted but the app can still be killed for
   * battery. Advisory rather than a state: it applies even while healthy,
   * because it is about what will go wrong, not what has.
   */
  needsBatteryExemption: boolean;
}

const DAY = 86_400_000;

/**
 * How long silence is allowed to run before it is worth mentioning.
 *
 * Three days is not suspicious - plenty of people go a weekend without paying
 * for anything by card. Ten is: it is longer than almost any real gap in
 * spending, so by then silence is more likely to be a dead listener than a
 * quiet fortnight. Neither number is a promise, which is why the wording
 * below asks the user rather than telling them.
 */
const QUIET_AFTER_DAYS = 3;
const STALLED_AFTER_DAYS = 10;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function captureHealth(facts: CaptureFacts): CaptureHealth {
  if (!facts.supported) {
    return {
      state: 'unsupported', tone: 'ok', daysSilent: null, needsBatteryExemption: false,
      headline: 'Not available here',
      detail: 'Reading payment alerts needs the Android app.',
    };
  }

  if (!facts.granted) {
    return {
      state: 'blocked', tone: 'bad', daysSilent: null, needsBatteryExemption: false,
      headline: 'Payment alerts are switched off',
      detail: 'Android has notification access turned off for MONEVA, so no '
            + 'payments can be noticed. Nothing is being missed quietly - '
            + 'nothing is arriving at all.',
    };
  }

  if (!facts.capturing) {
    return {
      state: 'off', tone: 'ok', daysSilent: null, needsBatteryExemption: false,
      headline: 'Not reading payment alerts',
      detail: 'You turned this off. Payments can still be added by hand.',
    };
  }

  const needsBatteryExemption = !facts.batteryExempt;
  const samsung = facts.manufacturer === 'samsung';

  /**
   * Android has dropped the listener. Known, not inferred.
   *
   * `connectedAt > 0` is the guard: it means the service has reported at least
   * once in its life, so its absence now is a disconnect and not a first
   * enable that Android has not yet bound. Without that guard every fresh
   * switch-on would flash this warning for the seconds before binding.
   *
   * The plugin has already asked for a rebind by the time this renders. The
   * button offers a second try; the Samsung line names the setting that stops
   * it happening again, because that is the phone this was observed on.
   */
  if (!facts.connected && facts.connectedAt > 0) {
    return {
      state: 'disconnected', tone: 'bad', daysSilent: null, needsBatteryExemption,
      headline: 'Android stopped the listener',
      detail: 'MONEVA is allowed to read alerts, but Android has unbound the '
            + 'service that does it - usually to save battery. Nothing is '
            + 'being noticed until it reconnects.'
            + (samsung
                ? ' On Samsung, add MONEVA to Never sleeping apps under '
                  + 'Battery, then it will stop happening.'
                : ''),
    };
  }

  // Silence is measured from whichever is later: the last payment seen, or the
  // moment capture was switched on. Without the second, re-enabling capture
  // after a month away would report a month of silence instantly.
  const since = Math.max(facts.lastKeptAt, facts.enabledAt);
  const days = since > 0 ? Math.floor((facts.now - since) / DAY) : null;

  if (facts.keptCount === 0) {
    const waited = days ?? 0;
    return {
      state: 'waiting', tone: 'ok', daysSilent: days, needsBatteryExemption,
      headline: 'Watching for payments',
      detail: waited >= STALLED_AFTER_DAYS
        ? `Nothing noticed in ${waited} days. If you have paid for anything in `
        + 'that time, the alerts may not be reaching MONEVA - reopening '
        + 'notification access usually fixes it.'
        : 'No payments noticed yet. The next one you make should appear here.',
    };
  }

  const n = facts.keptCount;
  const seen = `${n} ${plural(n, 'payment', 'payments')} noticed so far`;

  if (days === null || days < QUIET_AFTER_DAYS) {
    return {
      state: 'healthy', tone: 'ok', daysSilent: days, needsBatteryExemption,
      headline: 'Reading payment alerts',
      detail: days === 0
        ? `${seen}, including today.`
        : `${seen}. Last one ${days} ${plural(days ?? 0, 'day', 'days')} ago.`,
    };
  }

  if (days < STALLED_AFTER_DAYS) {
    return {
      state: 'quiet', tone: 'ok', daysSilent: days, needsBatteryExemption,
      headline: 'Nothing new lately',
      detail: `${seen}, but none in ${days} days. That is normal if you have `
            + 'not paid for anything.',
    };
  }

  return {
    state: 'stalled', tone: 'warn', daysSilent: days, needsBatteryExemption,
    headline: 'Nothing noticed in a while',
    detail: `No payment has been noticed in ${days} days, though ${n} `
          + `${plural(n, 'was', 'were')} noticed before that. If you have been `
          + 'paying for things as usual, MONEVA has probably stopped receiving '
          + 'the alerts. Opening the app reconnects it; letting it run in the '
          + 'background stops it happening.',
  };
}
