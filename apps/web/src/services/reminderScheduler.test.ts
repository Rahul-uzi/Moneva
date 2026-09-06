import { describe, it, expect } from 'vitest';
import { buildReminderPlan, stableId, MAX_SCHEDULED, type ReminderInput } from './reminderScheduler';

// A fixed "now": Thursday 3 Sept 2026, 14:00 local.
const NOW = new Date(2026, 8, 3, 14, 0, 0);
const iso = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

const base = (over: Partial<ReminderInput> = {}): ReminderInput => ({
  bills: [],
  salaryStreams: [],
  prefs: { notif_bills: true, notif_salary: true },
  now: NOW,
  ...over,
});

const bill = (over: Partial<ReminderInput['bills'][number]> = {}) => ({
  id: 'b1', name: 'Electricity', amount_minor: 210000, due_date: iso(2026, 9, 9), status: 'upcoming', ...over,
});

describe('buildReminderPlan - bills', () => {
  it('reminds the day before and on the due day, at 9am local', () => {
    const plan = buildReminderPlan(base({ bills: [bill()] }));
    expect(plan.map((r) => [r.title, r.at.getDate(), r.at.getHours()])).toEqual([
      ['Electricity is due tomorrow', 8, 9],
      ['Electricity is due today', 9, 9],
    ]);
    expect(plan.every((r) => r.channelId === 'bills' && r.route === '/plan')).toBe(true);
  });

  it('puts the amount in the body without paise noise', () => {
    const [before] = buildReminderPlan(base({ bills: [bill()] }));
    expect(before.body).toContain('₹2,100');
    expect(before.body).not.toContain('.00');
  });

  it('nags an overdue bill at the next 9am, not in the past', () => {
    // Due two days ago; now is 14:00, so the next slot is tomorrow 9am.
    const plan = buildReminderPlan(base({ bills: [bill({ due_date: iso(2026, 9, 1) })] }));
    expect(plan).toHaveLength(1);
    expect(plan[0].title).toBe('Electricity is overdue');
    expect([plan[0].at.getDate(), plan[0].at.getHours()]).toEqual([4, 9]);
    expect(plan[0].at.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('uses today 9am for an overdue bill when it is still early morning', () => {
    const early = new Date(2026, 8, 3, 7, 30);
    const plan = buildReminderPlan(base({ now: early, bills: [bill({ due_date: iso(2026, 9, 1) })] }));
    expect([plan[0].at.getDate(), plan[0].at.getHours()]).toEqual([3, 9]);
  });

  it('never schedules anything in the past', () => {
    // Due today: the "day before" slot (yesterday 9am) and today's 9am are
    // both behind a 14:00 now - so nothing, rather than an instant fire.
    const plan = buildReminderPlan(base({ bills: [bill({ due_date: iso(2026, 9, 3) })] }));
    expect(plan.every((r) => r.at > NOW)).toBe(true);
    expect(plan.some((r) => r.title.includes('due tomorrow'))).toBe(false);
  });

  it('skips paid and cancelled bills', () => {
    const plan = buildReminderPlan(base({ bills: [bill({ status: 'paid' }), bill({ id: 'b2', status: 'cancelled' })] }));
    expect(plan).toEqual([]);
  });

  it('respects the bills preference', () => {
    const plan = buildReminderPlan(base({ bills: [bill()], prefs: { notif_bills: false, notif_salary: true } }));
    expect(plan).toEqual([]);
  });
});

describe('buildReminderPlan - salary', () => {
  const stream = (over = {}) => ({
    id: 's1', source: 'Acme Corp', amount_minor: 7500000, next_occurrence: iso(2026, 9, 28), active: true, ...over,
  });

  it('asks on payday morning', () => {
    const [r] = buildReminderPlan(base({ salaryStreams: [stream()] }));
    expect(r.title).toBe('Payday from Acme Corp?');
    expect(r.body).toContain('₹75,000');
    expect([r.at.getDate(), r.at.getHours()]).toEqual([28, 9]);
    expect(r.channelId).toBe('salary');
    expect(r.route).toBe('/');
  });

  it('nudges once at the next slot when payday has passed unconfirmed', () => {
    const [r] = buildReminderPlan(base({ salaryStreams: [stream({ next_occurrence: iso(2026, 9, 1) })] }));
    expect(r.title).toBe('Acme Corp salary not confirmed');
    expect([r.at.getDate(), r.at.getHours()]).toEqual([4, 9]);
  });

  it('ignores paused streams and the salary preference', () => {
    expect(buildReminderPlan(base({ salaryStreams: [stream({ active: false })] }))).toEqual([]);
    expect(buildReminderPlan(base({ salaryStreams: [stream()], prefs: { notif_bills: true, notif_salary: false } }))).toEqual([]);
  });
});

describe('buildReminderPlan - shape', () => {
  it('orders soonest first', () => {
    const plan = buildReminderPlan(base({
      bills: [bill({ id: 'late', due_date: iso(2026, 9, 20) }), bill({ id: 'soon', due_date: iso(2026, 9, 5) })],
    }));
    const times = plan.map((r) => r.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(plan[0].key).toContain('soon');
  });

  it('caps the plan so it cannot flood the OS alarm table', () => {
    const many = Array.from({ length: 60 }, (_, i) => bill({ id: `b${i}`, due_date: iso(2026, 10, 1 + (i % 28)) }));
    expect(buildReminderPlan(base({ bills: many })).length).toBe(MAX_SCHEDULED);
  });

  it('gives the same reminder the same id every time, and different ones different ids', () => {
    const a = buildReminderPlan(base({ bills: [bill()] }));
    const b = buildReminderPlan(base({ bills: [bill()] }));
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
    expect(new Set(a.map((r) => r.id)).size).toBe(a.length);
  });

  it('stableId is positive and deterministic', () => {
    expect(stableId('x')).toBe(stableId('x'));
    expect(stableId('x')).toBeGreaterThan(0);
    expect(stableId('x')).not.toBe(stableId('y'));
  });
});
