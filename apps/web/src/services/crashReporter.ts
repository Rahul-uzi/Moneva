/**
 * The one place a crash is written down.
 *
 * A crash on somebody else's phone used to be invisible: they saw a broken
 * screen, closed the app, and nothing about it ever reached us. MONEVA is
 * installed from a website rather than a store, so there are no store vitals
 * to fall back on - what this file records is the only account of the fault
 * that will ever exist.
 *
 * Two steps, and the order is the point:
 *
 *   1. `report` writes to the device, synchronously, and never throws. It runs
 *      inside an error handler in an app that has just failed, so it does the
 *      smallest possible thing.
 *   2. `flushCrashes` sends what is on disk on the NEXT launch, when
 *      everything is working again. Nothing is sent at the moment of the crash.
 *
 * Reports go to MONEVA's own backend rather than to Sentry or Crashlytics.
 * That server already exists, already holds the user's records, and is already
 * named in the privacy page - so this adds no third party who receives data.
 *
 * What is sent is the fault and nothing else: a message, a route, a stack, a
 * version. No amounts, no account names, no transaction text. A stack trace
 * finds a bug; the figures that happened to be on screen do not, and
 * collecting them would turn a debugging aid into a copy of a ledger.
 */

export interface CrashRecord {
  /** ISO 8601, local clock. Wrong clocks are common; it is still the best we have. */
  at: string;
  /** The error's own message, trimmed. Never shown to the user unprompted. */
  message: string;
  /** Where in the app it happened - a route, or a component name. */
  where: string;
  /** React's component stack when we have it; the JS stack otherwise. */
  stack?: string;
  /** App version, so a report from an old build is recognisable as one. */
  version: string;
}

const STORE_KEY = 'moneva_crashes';
const SENT_KEY = 'moneva_crashes_sent';

/**
 * How many to keep.
 *
 * A crash loop can fire many times a second, and the useful one is almost
 * always the FIRST - everything after it is the same fault seen again. Keeping
 * a handful bounds the storage without losing the original.
 */
const KEEP = 5;

/** Read from Vite at build time; `dev` when running unbuilt. */
const appVersion = (): string =>
  (import.meta.env?.VITE_APP_VERSION as string | undefined) ?? 'dev';

/**
 * Trim a stack to something a person can paste into a message.
 *
 * Full React stacks run to hundreds of lines and are mostly framework frames.
 * The top of the stack is where the fault is.
 */
const trimStack = (stack: string | undefined): string | undefined => {
  if (!stack) return undefined;
  return stack.split('\n').slice(0, 12).join('\n').slice(0, 2000);
};

export const loadCrashes = (): CrashRecord[] => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CrashRecord[]) : [];
  } catch {
    // Unreadable storage is not itself worth crashing over - which would be a
    // particularly unhelpful way for the crash reporter to fail.
    return [];
  }
};

export const clearCrashes = (): void => {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* Nothing useful to do; the records simply stay. */
  }
};

/**
 * Record a crash. Never throws - a reporter that can fail is a second crash
 * on top of the first, and it would happen inside an error handler where
 * nothing is left to catch it.
 */
export const report = (
  error: unknown,
  where: string,
  componentStack?: string,
): void => {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const record: CrashRecord = {
      at: new Date().toISOString(),
      message: (err.message || 'Unknown error').slice(0, 300),
      where,
      stack: trimStack(componentStack || err.stack),
      version: appVersion(),
    };

    // Newest first, so the list reads the way a person expects, and the oldest
    // fall off the end.
    const next = [record, ...loadCrashes()].slice(0, KEEP);
    localStorage.setItem(STORE_KEY, JSON.stringify(next));

    // Still log it. On a debug build this is how it is actually found, and on
    // a release build nobody is reading the console anyway.
    if (import.meta.env?.DEV) console.error(`[crash] ${where}`, err);
  } catch {
    /* Deliberately silent. See above. */
  }
};

/**
 * One crash as text a person can paste into a message.
 *
 * Carries no account identifier, no email and no financial figures - just the
 * fault. A bug report should not be a data leak, and the person sending it has
 * no way to check what is inside before it goes.
 */
export const describeCrash = (c: CrashRecord): string =>
  [
    `MONEVA ${c.version}`,
    `When: ${c.at}`,
    `Where: ${c.where}`,
    `Error: ${c.message}`,
    c.stack ? `\n${c.stack}` : '',
  ].join('\n');


/**
 * Send anything not yet sent, on the NEXT launch.
 *
 * Not at the moment of the crash. The app has just failed badly enough to
 * unmount a screen; asking it to open a network connection and await a
 * response, inside an error handler, is asking the broken thing to perform
 * under load. The record is already on disk by then, and it will still be
 * there in a second when everything is working again.
 *
 * Silent either way. This runs on every launch and nobody should ever see it:
 * a crash reporter that produces a visible error is a second bug on top of
 * the first, and one the user cannot act on.
 */
export const flushCrashes = async (
  post: (record: CrashRecord) => Promise<unknown>,
): Promise<number> => {
  let sentKeys: string[] = [];
  try {
    sentKeys = JSON.parse(localStorage.getItem(SENT_KEY) || '[]') as string[];
  } catch {
    sentKeys = [];
  }

  // Identity is content plus time, so the same crash recorded twice is sent
  // once - and a crash loop that filled the local store does not become a
  // burst of identical requests.
  const keyOf = (c: CrashRecord) => `${c.at}|${c.message.slice(0, 60)}`;

  const pending = loadCrashes().filter((c) => !sentKeys.includes(keyOf(c)));
  if (pending.length === 0) return 0;

  let sent = 0;
  for (const record of pending) {
    try {
      await post(record);
      sentKeys.push(keyOf(record));
      sent += 1;
    } catch {
      // Offline, signed out, or the server refused. Leave it unsent and try
      // again next launch - the record stays on the device either way.
      break;
    }
  }

  try {
    // Bounded, or the sent-list outlives the crash list it describes.
    localStorage.setItem(SENT_KEY, JSON.stringify(sentKeys.slice(-20)));
  } catch {
    /* ignore */
  }
  return sent;
};
