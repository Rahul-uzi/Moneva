import { apiClient } from './apiClient';

/**
 * Marking a notification read when it is opened from the phone's tray.
 *
 * Tapping a MONEVA notification in the shade opened the app and left the same
 * notification unread inside it - the bell kept counting something the person
 * had just read. The tap now marks it read.
 *
 * The id is written down BEFORE the request goes out, and crossed off only
 * once the server has it. A tap is often what starts the app from cold, and
 * the request can be cut off by that start or by having no signal; whatever
 * is still written down is sent again on the next launch or sync.
 */

const PENDING_KEY = 'moneva_pending_notif_reads';

/** Fired after notifications were marked read, so the bell can recount. */
export const NOTIFICATIONS_CHANGED = 'moneva:notifications-changed';

const readPending = (): string[] => {
  try {
    const arr = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]') as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const writePending = (ids: string[]) => {
  try {
    if (ids.length) localStorage.setItem(PENDING_KEY, JSON.stringify(ids));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage unavailable: the request below is still made once */
  }
};

let flushing: Promise<void> | null = null;

/** Sends every read still waiting. Safe to call often; runs one at a time. */
export const flushPendingReads = (): Promise<void> => {
  if (flushing) return flushing;
  flushing = (async () => {
    const pending = readPending();
    if (!pending.length) return;
    const left: string[] = [];
    let changed = false;
    for (const id of pending) {
      try {
        await apiClient.patch(`/notifications/${id}/read`);
        changed = true;
      } catch (err) {
        // Gone from the server (deleted, or another account's): nothing left
        // to mark, so it is crossed off rather than retried for ever.
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status !== 404) left.push(id);
      }
    }
    // Ids added while this ran are kept too.
    const added = readPending().filter((id) => !pending.includes(id));
    writePending([...left, ...added]);
    if (changed) window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
  })().finally(() => { flushing = null; });
  return flushing;
};

/** A notification was opened from the tray: mark it read. */
export const markReadFromTray = (notificationId: string): Promise<void> => {
  const pending = readPending();
  if (!pending.includes(notificationId)) writePending([...pending, notificationId]);
  return flushPendingReads();
};
