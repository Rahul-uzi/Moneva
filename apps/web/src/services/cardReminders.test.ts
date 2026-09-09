import { describe, it, expect } from 'vitest';
import { buildReminderPlan, type ReminderCard, type ReminderInput } from './reminderScheduler';

/**
 * The reminder that pays for itself.
 *
 * Interest on an Indian card runs 36-46 percent a year, backdated to the
 * purchase date, with a late fee on top - and the people who miss these
 * mostly have the money to pay. A screen you have to remember to open is no
 * use against a thing you have forgotten, so the card has to come and find
 * you. That is what these cover.
 */

const base = (cards: ReminderCard[], now: Date): ReminderInput => ({
  bills: [],
  salaryStreams: [],
  cards,
  prefs: { notif_bills: true, notif_salary: true },
  now,
});

/** Statement closes on the 18th, payment due on the 8th of the next month. */
const card = (over: Partial<ReminderCard> = {}): ReminderCard => ({
  id: 'card-1',
  name: 'HDFC Regalia',
  statement_day: 18,
  due_day: 8,
  outstanding_minor: 5_000_00,
  ...over,
});

const on = (y: number, m: number, d: number, hh = 7) => new Date(y, m - 1, d, hh, 0);
const titles = (plan: ReturnType<typeof buildReminderPlan>) => plan.map((r) => r.title);
const when = (plan: ReturnType<typeof buildReminderPlan>, part: string) =>
  plan.find((r) => r.title.includes(part))?.at;

describe('a card payment coming up', () => {
  it('warns three days out, the day before, and on the day', () => {
    // Three days, not one: paying a card usually means moving money first,
    // and a warning that arrives after the transfer window has closed is an
    // apology rather than a reminder.
    const plan = buildReminderPlan(base([card()], on(2026, 10, 1)));
    expect(titles(plan)).toEqual([
      'HDFC Regalia payment due in 3 days',
      'HDFC Regalia payment due tomorrow',
      'HDFC Regalia payment due today',
    ]);
  });

  it('puts each one at nine in the morning on the right day', () => {
    const plan = buildReminderPlan(base([card()], on(2026, 10, 1)));
    expect(when(plan, 'in 3 days')).toEqual(new Date(2026, 9, 5, 9, 0, 0, 0));
    expect(when(plan, 'tomorrow')).toEqual(new Date(2026, 9, 7, 9, 0, 0, 0));
    expect(when(plan, 'due today')).toEqual(new Date(2026, 9, 8, 9, 0, 0, 0));
  });

  it('names the amount still owed, not what was spent', () => {
    const plan = buildReminderPlan(base([card({ outstanding_minor: 12_345_00 })], on(2026, 10, 1)));
    expect(plan[0].body).toContain('12,345');
  });

  it('drops the ones whose moment has already passed', () => {
    // Two days out: the three-day warning is gone, the other two remain.
    const plan = buildReminderPlan(base([card()], on(2026, 10, 6)));
    expect(titles(plan)).toEqual([
      'HDFC Regalia payment due tomorrow',
      'HDFC Regalia payment due today',
    ]);
  });

  it('points at the screen that shows the card', () => {
    const plan = buildReminderPlan(base([card()], on(2026, 10, 1)));
    expect(plan.every((r) => r.route === '/accounts')).toBe(true);
    expect(plan.every((r) => r.channelId === 'cards')).toBe(true);
  });
});

describe('the day it is due', () => {
  it('still says something in the evening when the morning slot has gone', () => {
    // Opening the app at noon on the due date used to earn nothing at all
    // until the following morning - by which time it is already late.
    const plan = buildReminderPlan(base([card()], on(2026, 10, 8, 12)));
    expect(titles(plan)).toEqual(['HDFC Regalia payment due today']);
    expect(when(plan, 'due today')).toEqual(new Date(2026, 9, 8, 18, 0, 0, 0));
  });

  it('does not call it overdue while the day is still running', () => {
    const plan = buildReminderPlan(base([card()], on(2026, 10, 8, 23)));
    expect(titles(plan).join()).not.toContain('overdue');
  });
});

describe('a card already late', () => {
  it('comes back the next morning', () => {
    const plan = buildReminderPlan(base([card()], on(2026, 10, 10, 11)));
    expect(titles(plan)).toEqual(['HDFC Regalia payment is overdue']);
    expect(when(plan, 'overdue')).toEqual(new Date(2026, 9, 11, 9, 0, 0, 0));
  });

  it('says when it was due, so the message is not a mystery', () => {
    const plan = buildReminderPlan(base([card()], on(2026, 10, 10, 11)));
    expect(plan[0].body).toContain('8 Oct');
  });
});

describe('when a card should say nothing', () => {
  it('is silent once the statement is paid off', () => {
    // The failure that teaches people to ignore the next one.
    expect(buildReminderPlan(base([card({ outstanding_minor: 0 })], on(2026, 10, 1)))).toEqual([]);
  });

  it('is silent when reminders are switched off', () => {
    const input = base([card()], on(2026, 10, 1));
    input.prefs.notif_bills = false;
    expect(buildReminderPlan(input)).toEqual([]);
  });

  it('plans nothing when the caller has no card data at all', () => {
    const input = base([], on(2026, 10, 1));
    delete input.cards;
    expect(buildReminderPlan(input)).toEqual([]);
  });
});

describe('more than one card', () => {
  it('keeps them apart and in the order they arrive', () => {
    // On 20 September both are still ahead, and they disagree about which
    // month they fall in: Amex closes on the 5th and is due on the 25th, the
    // SAME month, while HDFC closes on the 18th and is due on the 8th of the
    // next. A scheduler that assumed "always next month" would put the Amex
    // reminders four weeks late.
    const plan = buildReminderPlan(base([
      card(),
      card({ id: 'card-2', name: 'Amex Gold', statement_day: 5, due_day: 25 }),
    ], on(2026, 9, 20)));

    expect(when(plan, 'Amex Gold payment due today')).toEqual(new Date(2026, 8, 25, 9, 0, 0, 0));
    expect(when(plan, 'HDFC Regalia payment due today')).toEqual(new Date(2026, 9, 8, 9, 0, 0, 0));

    // Soonest first, whichever card it belongs to.
    const times = plan.map((r) => r.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('treats a same-month due date that has passed as overdue', () => {
    // The trap the fixture above walked into: a card closing on the 5th and
    // due on the 25th is not "due next month" on 1 October - that payment was
    // owed on 25 September and is already late.
    const plan = buildReminderPlan(base(
      [card({ id: 'card-2', name: 'Amex Gold', statement_day: 5, due_day: 25 })],
      on(2026, 10, 1),
    ));
    expect(titles(plan)).toEqual(['Amex Gold payment is overdue']);
    expect(plan[0].body).toContain('25 Sept');
  });

  it('gives every reminder its own id, and the same id every time', () => {
    // Re-planning replaces rather than duplicates, so a card cannot end up
    // with the same alert three times over.
    const input = () => base([
      card(),
      card({ id: 'card-2', name: 'Amex Gold', statement_day: 5, due_day: 25 }),
    ], on(2026, 10, 1));

    const first = buildReminderPlan(input());
    const again = buildReminderPlan(input());
    expect(new Set(first.map((r) => r.id)).size).toBe(first.length);
    expect(again.map((r) => r.id)).toEqual(first.map((r) => r.id));
  });
});

describe('alongside the reminders that already existed', () => {
  it('does not displace bills or salary', () => {
    const plan = buildReminderPlan({
      bills: [{
        id: 'b1', name: 'Electricity', amount_minor: 90_000,
        due_date: new Date(2026, 9, 3).toISOString(), status: 'pending',
      }],
      salaryStreams: [],
      cards: [card()],
      prefs: { notif_bills: true, notif_salary: true },
      now: on(2026, 10, 1),
    });
    expect(plan.some((r) => r.channelId === 'bills')).toBe(true);
    expect(plan.some((r) => r.channelId === 'cards')).toBe(true);
  });
});
