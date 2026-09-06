import { describe, it, expect } from 'vitest';
import { TOUR_STEPS } from './tourSteps';

const VALID_ROUTES = new Set(['/', '/activity', '/plan', '/assistant']);
const VALID_SCENES = new Set([
  'grow', 'add', 'payday', 'accounts', 'list', 'search', 'rings', 'goal', 'chat', 'bell', 'lock',
]);

describe('guided tour steps', () => {
  it('has a sensible length - long enough to cover the app, short enough to finish', () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(8);
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(14);
  });

  it('gives every step a unique id', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only targets elements by their data-tour anchor, never by a styling class', () => {
    // A class rename during a redesign must not silently break the tour.
    for (const s of TOUR_STEPS) {
      expect(s.selector).toMatch(/^\[data-tour="[a-z-]+"\]$/);
    }
  });

  it('only visits routes that exist behind the app shell', () => {
    for (const s of TOUR_STEPS) expect(VALID_ROUTES.has(s.route)).toBe(true);
  });

  it('starts and ends on Home, so finishing leaves the user where they began', () => {
    expect(TOUR_STEPS[0].route).toBe('/');
    expect(TOUR_STEPS[TOUR_STEPS.length - 1].route).toBe('/');
  });

  it('visits every main screen at least once', () => {
    const visited = new Set<string>(TOUR_STEPS.map((s) => s.route));
    expect([...VALID_ROUTES].every((r) => visited.has(r))).toBe(true);
  });

  it('keeps copy short enough to read on a phone', () => {
    for (const s of TOUR_STEPS) {
      expect(s.title.length).toBeLessThanOrEqual(40);
      expect(s.body.length).toBeLessThanOrEqual(170);
      expect(s.title.trim()).toBe(s.title);
    }
  });

  it('greets the user on the very first step and nowhere else', () => {
    expect(TOUR_STEPS[0].greeting).toBe(true);
    expect(TOUR_STEPS.slice(1).every((s) => !s.greeting)).toBe(true);
  });

  it('groups steps by screen rather than bouncing between routes', () => {
    // Each route should appear as one contiguous run, except the return to
    // Home at the end.
    const runs: string[] = [];
    for (const s of TOUR_STEPS) {
      if (runs[runs.length - 1] !== s.route) runs.push(s.route);
    }
    const homeRuns = runs.filter((r) => r === '/').length;
    expect(homeRuns).toBeLessThanOrEqual(2);
    expect(runs.length).toBeLessThanOrEqual(VALID_ROUTES.size + 1);
  });
});

describe('guided tour visuals', () => {
  it('draws only scenes the scene library knows', () => {
    for (const s of TOUR_STEPS) expect(VALID_SCENES.has(s.scene)).toBe(true);
  });

  it('never shows the same scene twice in a row', () => {
    for (let i = 1; i < TOUR_STEPS.length; i += 1) {
      expect(TOUR_STEPS[i].scene).not.toBe(TOUR_STEPS[i - 1].scene);
    }
  });

  it('gives each step a valid accent colour, and varies it between neighbours', () => {
    for (const s of TOUR_STEPS) expect(s.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
    for (let i = 1; i < TOUR_STEPS.length; i += 1) {
      expect(TOUR_STEPS[i].accent.toLowerCase()).not.toBe(TOUR_STEPS[i - 1].accent.toLowerCase());
    }
  });

  it('uses a round spotlight for round targets and a box for cards', () => {
    const byId = Object.fromEntries(TOUR_STEPS.map((s) => [s.id, s.shape]));
    expect(byId['quick-add']).toBe('pill');
    expect(byId['notifications']).toBe('pill');
    expect(byId['profile']).toBe('pill');
    expect(byId['net-worth']).toBe('box');
    expect(byId['plan-metrics']).toBe('box');
  });
});
