import type { IllustrationName } from '../ui/Illustration';

/**
 * One stop on the guided tour.
 *
 * `selector` points at a real element on the real screen (every target
 * carries a `data-tour` attribute, so a class rename cannot silently break the
 * tour). `route` is where that element lives; the engine navigates there
 * first. A target that never appears - a card that only renders with data -
 * is skipped rather than blocking the tour.
 *
 * `scene` names a drawing from the app's one illustration set. There is no
 * per-step accent any more: the set is drawn in a single voltage pen, the same
 * one the logo is drawn with, so a step's colour is never a separate decision.
 */
export interface TourStep {
  id: string;
  route: '/' | '/activity' | '/plan' | '/assistant';
  selector: string;
  title: string;
  body: string;
  scene: IllustrationName;
  /** Round spotlight for round things: nav icons, the + button, the avatar. */
  shape: 'box' | 'pill';
  /** Where the card prefers to sit; the engine flips it if there is no room. */
  placement: 'above' | 'below';
  /** Opens with "Hey <name>!" - the first thing a new user sees. */
  greeting?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'net-worth',
    route: '/',
    selector: '[data-tour="net-worth"]',
    title: 'Your money at a glance',
    body: 'Everything you own minus everything you owe, and it grows the moment you record anything.',
    scene: 'chart',
    shape: 'box',
    placement: 'below',
    greeting: true,
  },
  {
    id: 'quick-add',
    route: '/',
    selector: '[data-tour="quick-add"]',
    title: 'Add anything in seconds',
    body: 'Tap + on any screen for an expense, income or a transfer. The date is already set to now.',
    scene: 'add',
    shape: 'pill',
    placement: 'above',
  },
  {
    id: 'salary',
    route: '/',
    selector: '[data-tour="salary"]',
    title: 'Your salary, tracked',
    body: 'Add it once. Each month MONEVA asks whether it arrived and shows how much of it is left to spend.',
    scene: 'calendar',
    shape: 'box',
    placement: 'below',
  },
  {
    id: 'accounts',
    route: '/',
    selector: '[data-tour="accounts"]',
    title: 'Every account in one place',
    body: 'Bank, cash and cards. Move money between your own accounts and your total stays the same - spend it and it goes down.',
    scene: 'wallet',
    shape: 'box',
    placement: 'above',
  },
  {
    id: 'activity-tabs',
    route: '/activity',
    selector: '[data-tour="activity-tabs"]',
    title: 'Every transaction, filtered',
    body: 'Switch between spending, income and transfers. Long-press any row to edit or delete it.',
    scene: 'ledger',
    shape: 'box',
    placement: 'below',
  },
  {
    id: 'activity-search',
    route: '/activity',
    selector: '[data-tour="activity-search"]',
    title: 'Find anything fast',
    body: 'Search by name or amount, and narrow it to this month, the last 30 days, or longer.',
    scene: 'search',
    shape: 'box',
    placement: 'below',
  },
  {
    id: 'plan-metrics',
    route: '/plan',
    selector: '[data-tour="plan-metrics"]',
    title: 'Budgets, savings and bills',
    body: 'How much of each budget is used, how close your goals are, and what is due - with one line saying what needs attention.',
    scene: 'budget',
    shape: 'box',
    placement: 'below',
  },
  {
    id: 'plan-add',
    route: '/plan',
    selector: '[data-tour="plan-add"]',
    title: 'Cap it, save for it, get reminded',
    body: 'Set a spending limit on a category, save towards something, or add a bill and MONEVA reminds you before it is due.',
    scene: 'goal',
    shape: 'box',
    placement: 'below',
  },
  {
    id: 'assistant',
    route: '/assistant',
    selector: '[data-tour="assistant-input"]',
    title: 'Just ask',
    body: '"How much did I spend on food?" or "bike 711.8" - type it in plain words and MONEVA answers from your real numbers.',
    scene: 'ask',
    shape: 'box',
    placement: 'above',
  },
  {
    id: 'notifications',
    route: '/',
    selector: '[data-tour="notifications"]',
    title: 'Reminders find you',
    body: 'Bills due, budgets running hot, payday. They arrive on your phone even when the app is closed.',
    scene: 'bell',
    shape: 'pill',
    placement: 'below',
  },
  {
    id: 'profile',
    route: '/',
    selector: '[data-tour="profile"]',
    title: 'Lock it down',
    body: 'Your profile holds the biometric app lock, notification settings and a dark theme. You are all set.',
    scene: 'secure',
    shape: 'pill',
    placement: 'below',
  },
];
