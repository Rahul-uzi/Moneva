/**
 * The one place a crash is written down.
 *
 * There is no crash-reporting service wired up yet, and until there is, a
 * crash on somebody else's phone is invisible: they see a broken screen, they
 * close the app, and nothing about it ever reaches us. MONEVA is distributed
 * from a website rather than a store, so there are no Play vitals to fall back
 * on either - this file is the only record that will exist.
 *
 * So it keeps the last few crashes on the device, where the user can read them
 * and send them on if they choose. That is worth more than it sounds: the
 * hardest part of a bug report is the stack trace, and this is the only thing
 * that can capture it at the moment it happens.
 *
 * It is also deliberately the ONLY seam. When Sentry or Crashlytics is added,
 * `report` is where it goes and nothing else in the app changes.
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
