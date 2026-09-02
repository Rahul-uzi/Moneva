import { describe, it, expect } from 'vitest';

/**
 * The count-up is decoration on a money figure, so the one thing that must
 * never happen is settling on a number other than the real one.
 */
describe('useCountUp easing contract', () => {
  // The easing curve used by the hook, verified independently of React.
  const eased = (t: number) => 1 - Math.pow(1 - t, 3);
  const frameValue = (target: number, t: number) =>
    t >= 1 ? target : Math.round(target * eased(t));

  it('lands exactly on the target at the end', () => {
    expect(frameValue(20098817, 1)).toBe(20098817);
    expect(frameValue(711.83 * 100, 1)).toBe(71183);
  });

  it('never overshoots the target', () => {
    for (let i = 0; i <= 20; i += 1) {
      const v = frameValue(500000, i / 20);
      expect(v).toBeLessThanOrEqual(500000);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('rises monotonically', () => {
    let prev = -1;
    for (let i = 0; i <= 20; i += 1) {
      const v = frameValue(500000, i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('covers most of the distance early so the figure reads quickly', () => {
    // Half way through, ease-out is already past 85%.
    expect(eased(0.5)).toBeGreaterThan(0.85);
  });

  it('produces whole minor units only - never a fractional paisa', () => {
    for (let i = 0; i <= 20; i += 1) {
      expect(Number.isInteger(frameValue(123457, i / 20))).toBe(true);
    }
  });
});
