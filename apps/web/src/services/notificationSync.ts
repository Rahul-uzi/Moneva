/**
 * One entry point that makes notifications actually happen.
 *
 * Runs on launch, on return to the foreground, and after anything that can
 * change a due date. It asks the server to generate any reminders that are
 * due right now, posts the unread ones to the system tray, then re-plans the
 * device-side alarms for what is coming - so the next reminder fires with the
 * app closed, which nothing in the old pipeline could do.
 *
 * Every step is best-effort: a failed request must never take the app down.
 */
import { Capacitor } from '@capacitor/core';
import { apiClient } from './apiClient';
import { nativeNotificationService, type UserNotifPreferences } from './notificationService';
import { shouldSync, syncDeviceReminders, type ReminderCard } from './reminderScheduler';
import { cardCycle, cardLedger, cycleTotals } from '../utils/cardCycle';
import { runAutoAdd } from './autoAddRunner';
import type {
  Account, Bill, Category, NotificationRecord, RecurringIncome, Transaction,
} from '../types/api';

const DEFAULT_PREFS: UserNotifPreferences = {
  notif_bills: true,
  notif_budgets: true,
  notif_goals: true,
  notif_salary: true,
};

const settled = async <T>(p: Promise<{ data: T }>, fallback: T): Promise<T> => {
  try {
    return (await p).data;
  } catch {
    return fallback;
  }
};

export interface SyncResult {
  skipped: boolean;
  permission: string;
  deliveredNow: number;
  scheduled: number;
  /** Payments filed without asking on this pass. Zero unless switched on. */
  autoAdded: number;
}

export const runNotificationSync = async (opts: { force?: boolean } = {}): Promise<SyncResult> => {
  const result: SyncResult = {
    skipped: true, permission: 'n/a', deliveredNow: 0, scheduled: 0, autoAdded: 0,
  };
  if (!Capacitor.isNativePlatform()) return result;

  const now = new Date();
  if (!shouldSync(now, opts.force)) return result;
  result.skipped = false;

  result.permission = await nativeNotificationService.ensurePermission();
  if (result.permission !== 'granted') return result;

  // Let the server materialise anything that has become due since last time.
  try {
    await apiClient.post('/notifications/generate');
  } catch {
    /* offline or cold backend - the device plan below still runs */
  }

  /* The ledger window matches the card panel: back to the statement before
     last, by date rather than by row count, so a busy month cannot drop the
     previous-cycle purchases that make up the amount owed. Understating that
     would produce the worst possible reminder - one that tells somebody they
     owe less than they do. */
  const since = new Date(now.getTime() - 120 * 86_400_000).toISOString();

  const [notifs, prefs, bills, streams, accounts, ledger, categories] = await Promise.all([
    settled(apiClient.get<NotificationRecord[]>('/notifications'), [] as NotificationRecord[]),
    settled(apiClient.get<UserNotifPreferences>('/notifications/preferences'), DEFAULT_PREFS),
    settled(apiClient.get<Bill[]>('/bills'), [] as Bill[]),
    settled(apiClient.get<RecurringIncome[]>('/income/recurring'), [] as RecurringIncome[]),
    settled(apiClient.get<Account[]>('/accounts'), [] as Account[]),
    settled(apiClient.get<Transaction[]>('/transactions', { params: { start_date: since } }),
            [] as Transaction[]),
    // Only so an auto-filed row can repeat a category the user already chose
    // for that merchant. Failure is an empty list, which means "no category" -
    // never a guessed one.
    settled(apiClient.get<Category[]>('/categories'), [] as Category[]),
  ]);

  /* What each card still owes, worked out exactly as the card screen works it
     out - same functions, same instant - so a reminder can never quote a
     figure the screen disagrees with. */
  const cards: ReminderCard[] = accounts
    .filter((a) => a.is_active && a.statement_day != null && a.due_day != null)
    .map((a) => {
      const terms = { statementDay: a.statement_day as number, dueDay: a.due_day as number };
      const totals = cycleTotals(cardLedger(ledger, a.id), cardCycle(terms, now.getTime()), terms);
      return {
        id: a.id,
        name: a.name,
        statement_day: terms.statementDay,
        due_day: terms.dueDay,
        outstanding_minor: totals.outstandingMinor,
      };
    });

  for (const n of notifs.filter((x) => !x.is_read)) {
    if (await nativeNotificationService.deliverNativeNotification(n, prefs)) result.deliveredNow += 1;
  }

  /* Runs here because this is the path that already fires on launch and on
     return to the foreground - the moments when a phone that was closed has a
     queue waiting. Before the reminders, so a payment that lands now is part
     of the picture the reminders are planned from. Failure is swallowed: an
     unfiled payment simply stays in the inbox, which is where it used to be. */
  try {
    const outcome = await runAutoAdd(accounts, now.getTime(), categories, ledger);
    result.autoAdded = outcome.added;
  } catch {
    /* the proposals stay queued for the inbox */
  }

  try {
    result.scheduled = await syncDeviceReminders({
      bills: bills.map((b) => ({
        id: b.id,
        name: b.name,
        amount_minor: b.amount_minor,
        due_date: b.due_date,
        status: b.status,
      })),
      salaryStreams: streams.map((s) => ({
        id: s.id,
        source: s.source,
        amount_minor: s.amount_minor,
        next_occurrence: s.next_occurrence,
        active: s.active,
      })),
      cards,
      prefs: { notif_bills: prefs.notif_bills, notif_salary: prefs.notif_salary },
      now,
    });
  } catch {
    /* scheduling is best-effort */
  }

  return result;
};
