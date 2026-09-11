/**
 * Plans reminders ahead of time so they fire while the app is closed.
 *
 * The old pipeline only "sent" a notification while the user was already
 * reading the bell modal: the server generated reminders on demand, the app
 * asked for them on demand, and native delivery happened in that same fetch.
 * A bill due tomorrow reached nobody. There is no push infrastructure and the
 * hosted backend sleeps when idle, so the device has to be the alarm clock:
 * every time the app runs it re-plans the next few reminders from real data
 * and hands them to the OS as scheduled local notifications.
 *
 * `buildReminderPlan` is pure - dates in, reminders out - so the timing rules
 * are unit-tested without the plugin. `syncDeviceReminders` is the thin layer
 * that talks to the OS.
 */
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { formatMonetaryCompact } from '../utils/money';
import { parseApiDate } from '../utils/datetime';
import { cardCycle } from '../utils/cardCycle';

export interface ReminderBill {
  id: string;
  name: string;
  amount_minor: number;
  due_date: string;
  status: string;
}

export interface ReminderSalaryStream {
  id: string;
  source: string;
  amount_minor: number;
  next_occurrence: string;
  active: boolean;
}

export interface ReminderPrefs {
  notif_bills: boolean;
  notif_salary: boolean;
}

/**
 * A credit card, reduced to what a reminder needs.
 *
 * The amount is passed in rather than derived here: what is owed comes from
 * the ledger, which this module deliberately knows nothing about. The two
 * days come along so the due date is computed by the same function the card
 * screen uses - one place where that arithmetic lives, so a reminder can
 * never disagree with the screen it points at.
 */
export interface ReminderCard {
  id: string;
  name: string;
  statement_day: number;
  due_day: number;
  /** Still owed on the statement that closed. Nothing owed, nothing to say. */
  outstanding_minor: number;
}

export interface ReminderInput {
  bills: ReminderBill[];
  salaryStreams: ReminderSalaryStream[];
  /** Optional so a caller with no card data still plans bills and salary. */
  cards?: ReminderCard[];
  prefs: ReminderPrefs;
  now: Date;
  /** Local hour reminders fire at. 9am: after people wake, before they spend. */
  hour?: number;
}

export interface PlannedReminder {
  /** Stable numeric id, so re-planning replaces rather than duplicates. */
  id: number;
  key: string;
  title: string;
  body: string;
  at: Date;
  channelId: 'bills' | 'salary' | 'cards';
  route: string;
}

/** The OS keeps a bounded alarm table; a runaway plan must not fill it. */
export const MAX_SCHEDULED = 40;

const LAST_SYNC_KEY = 'moneva_reminders_synced_at';
const MIN_SYNC_GAP_MS = 15 * 60 * 1000;

/** Same string always maps to the same positive 31-bit id. */
export const stableId = (key: string): number => {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || 1;
};

const atHour = (day: Date, hour: number): Date =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0);

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The next `hour` o'clock strictly after `now` - today if still ahead, else tomorrow. */
const nextSlot = (now: Date, hour: number): Date => {
  const today = atHour(now, hour);
  if (today > now) return today;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return atHour(tomorrow, hour);
};

export const buildReminderPlan = (input: ReminderInput): PlannedReminder[] => {
  const { bills, salaryStreams, prefs, now } = input;
  const hour = input.hour ?? 9;
  // A second slot on the due day itself. Someone who opens the app at noon on
  // the day a card is due has already missed the morning reminder, and the
  // next one would land the morning after - by which time the interest has
  // started. Evening still leaves time to pay.
  const lateHour = Math.min(23, hour + 9);
  const out: PlannedReminder[] = [];

  const push = (r: Omit<PlannedReminder, 'id'>) => {
    // Never schedule into the past: the OS fires those immediately, which would
    // spray stale alerts the moment the app opened.
    if (r.at <= now) return;
    out.push({ ...r, id: stableId(r.key) });
  };

  if (prefs.notif_bills) {
    bills
      .filter((b) => b.status !== 'paid' && b.status !== 'cancelled')
      .forEach((b) => {
        const due = parseApiDate(b.due_date);
        const amount = formatMonetaryCompact(b.amount_minor);
        const dueDay = atHour(due, hour);

        if (dueDay > now) {
          const before = new Date(due);
          before.setDate(before.getDate() - 1);
          push({
            key: `bill:${b.id}:before:${dayKey(due)}`,
            title: `${b.name} is due tomorrow`,
            body: `${amount} due ${due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}. Tap to pay or mark it paid.`,
            at: atHour(before, hour),
            channelId: 'bills',
            route: '/plan',
          });
          push({
            key: `bill:${b.id}:due:${dayKey(due)}`,
            title: `${b.name} is due today`,
            body: `${amount} due today.`,
            at: dueDay,
            channelId: 'bills',
            route: '/plan',
          });
        } else {
          // Already overdue: one nudge at the next morning slot. Re-planned on
          // every launch, so it keeps nagging daily until it is paid.
          const slot = nextSlot(now, hour);
          push({
            key: `bill:${b.id}:overdue:${dayKey(slot)}`,
            title: `${b.name} is overdue`,
            body: `${amount} was due ${due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} and is still unpaid.`,
            at: slot,
            channelId: 'bills',
            route: '/plan',
          });
        }
      });
  }

  /* A credit card is the reminder that pays for itself.

     Interest on an Indian card runs 36-46 percent a year, backdated to the
     purchase date, with a late fee on top - and people miss these on cards
     they have the money to pay. Everything else here is a nudge; this one is
     the difference between owing what you spent and owing half again.

     Three days of warning rather than one, because paying a card usually
     means moving money first, and a reminder that arrives after the transfer
     window has closed is just an apology. */
  if (prefs.notif_bills) {
    (input.cards ?? []).forEach((c) => {
      // Nothing owed, nothing to chase. Nagging somebody about a card they
      // have already paid is worse than silence: it teaches them to ignore
      // the next one, which will be the one that matters.
      if (c.outstanding_minor <= 0) return;

      const cycle = cardCycle(
        { statementDay: c.statement_day, dueDay: c.due_day }, now.getTime(),
      );
      const due = new Date(cycle.dueAt);
      const amount = formatMonetaryCompact(c.outstanding_minor);
      const onDue = atHour(due, hour);
      const dayLabel = due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

      if (onDue > now) {
        const daysOut = (n: number) => {
          const d = new Date(due);
          d.setDate(d.getDate() - n);
          return atHour(d, hour);
        };
        push({
          key: `card:${c.id}:t3:${dayKey(due)}`,
          title: `${c.name} payment due in 3 days`,
          body: `${amount} due ${dayLabel}. Move the money now if it needs to come from elsewhere.`,
          at: daysOut(3),
          channelId: 'cards',
          route: '/accounts',
        });
        push({
          key: `card:${c.id}:t1:${dayKey(due)}`,
          title: `${c.name} payment due tomorrow`,
          body: `${amount} due ${dayLabel}.`,
          at: daysOut(1),
          channelId: 'cards',
          route: '/accounts',
        });
        push({
          key: `card:${c.id}:due:${dayKey(due)}`,
          title: `${c.name} payment due today`,
          body: `${amount} due today. Interest is backdated to the purchase, so a day late costs more than a day.`,
          at: onDue,
          channelId: 'cards',
          route: '/accounts',
        });
      } else if (!cycle.isOverdue) {
        // Still the due day, but past the morning slot - one more chance
        // tonight rather than nothing until it is already late.
        push({
          key: `card:${c.id}:duelate:${dayKey(due)}`,
          title: `${c.name} payment due today`,
          body: `${amount} still due today.`,
          at: atHour(due, lateHour),
          channelId: 'cards',
          route: '/accounts',
        });
      } else {
        // Re-planned on every launch, so this keeps returning each morning
        // until the payment lands and the amount owed reaches zero.
        const slot = nextSlot(now, hour);
        push({
          key: `card:${c.id}:overdue:${dayKey(slot)}`,
          title: `${c.name} payment is overdue`,
          body: `${amount} was due ${dayLabel}. Interest is accruing on the whole balance.`,
          at: slot,
          channelId: 'cards',
          route: '/accounts',
        });
      }
    });
  }

  if (prefs.notif_salary) {
    salaryStreams
      .filter((s) => s.active)
      .forEach((s) => {
        const when = parseApiDate(s.next_occurrence);
        const amount = formatMonetaryCompact(s.amount_minor);
        const payday = atHour(when, hour);
        if (payday > now) {
          push({
            key: `salary:${s.id}:${dayKey(when)}`,
            title: `Payday from ${s.source}?`,
            body: `${amount} expected today. Confirm it in MONEVA once it lands.`,
            at: payday,
            channelId: 'salary',
            route: '/',
          });
        } else {
          const slot = nextSlot(now, hour);
          push({
            key: `salary:${s.id}:unconfirmed:${dayKey(slot)}`,
            title: `${s.source} salary not confirmed`,
            body: `${amount} was expected. Did it arrive?`,
            at: slot,
            channelId: 'salary',
            route: '/',
          });
        }
      });
  }

  // Soonest first, then capped - the far-future ones are re-planned later
  // anyway, so dropping them loses nothing.
  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_SCHEDULED);
};

/** True when enough time has passed that re-planning is worth the API calls. */
export const shouldSync = (now: Date = new Date(), force = false): boolean => {
  if (force) return true;
  try {
    const last = Number(localStorage.getItem(LAST_SYNC_KEY) || 0);
    return now.getTime() - last >= MIN_SYNC_GAP_MS;
  } catch {
    return true;
  }
};

export const markSynced = (now: Date = new Date()): void => {
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(now.getTime()));
  } catch {
    /* storage unavailable - we just sync a little more often */
  }
};

/**
 * Replaces every pending MONEVA reminder on the device with the current plan.
 *
 * Cancel-then-schedule, keyed by stable ids: a bill that was paid disappears,
 * a bill whose date moved is re-timed, an unchanged bill is re-created
 * identically. Returns how many were scheduled.
 */
export const syncDeviceReminders = async (input: ReminderInput): Promise<number> => {
  if (!Capacitor.isNativePlatform()) return 0;

  const perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted') return 0;

  const plan = buildReminderPlan(input);

  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length > 0) {
    await LocalNotifications.cancel({
      notifications: pending.notifications.map((n) => ({ id: n.id })),
    });
  }

  if (plan.length > 0) {
    await LocalNotifications.schedule({
      notifications: plan.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        channelId: r.channelId,
        schedule: { at: r.at, allowWhileIdle: true },
        // Inexact on purpose. A "due today" reminder does not need 09:00:00 to
        // the second, and an inexact alarm lets Android batch it with other
        // apps' wake-ups - the cheapest kind there is. It also means the app
        // needs no exact-alarm permission at all.
        isExactNotification: false,
        smallIcon: 'ic_stat_moneva',
        iconColor: '#CDFF4A',
        extra: { route: r.route, source: 'moneva-reminder', key: r.key },
      })),
    });
  }

  markSynced(input.now);
  return plan.length;
};
