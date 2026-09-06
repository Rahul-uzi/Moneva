import { describe, it, expect } from 'vitest';
import { circlePath, cubicAt, metaballPath, metaballShape, type Pt } from './metaball';

/**
 * The nav marker's whole character comes from this shape, and a wrong path is
 * either invisible or a jagged mess on the device - neither of which a unit
 * test would normally catch. These check the properties that matter: that the
 * two bodies are joined while they are close, that the join is made of curves
 * rather than straight edges, that it breaks when pulled too far, and that
 * nothing ever emits NaN into a `d` attribute.
 */
const at = (x: number, y = 0): Pt => ({ x, y });

/** Every number in a path, so we can check the geometry it describes. */
const numbersIn = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('metaballPath', () => {
  it('joins two circles that are close together', () => {
    const d = metaballPath(at(0), 20, at(40), 20);
    expect(d).toBeTruthy();
    // Two curves for the two sides of the neck, two arcs for the far sides.
    expect((d!.match(/C /g) ?? []).length).toBe(2);
    expect((d!.match(/A /g) ?? []).length).toBe(2);
    expect(d).toMatch(/Z$/);
  });

  it('breaks the join once they are pulled too far apart', () => {
    // Liquid does not stretch indefinitely; past the limit there is no thread.
    expect(metaballPath(at(0), 12, at(400), 12)).toBeNull();
  });

  it('holds on at a distance a short journey actually reaches', () => {
    // A tab-to-tab hop is about 70px with these radii, and must stay joined.
    expect(metaballPath(at(0), 18, at(70), 16)).toBeTruthy();
  });

  it('refuses to draw when one body has swallowed the other', () => {
    expect(metaballPath(at(0), 30, at(2), 6)).toBeNull();
  });

  it('declines the join when the bodies nearly coincide', () => {
    // At this range the construction collapses into a crescent rather than the
    // union - which is what drew the resting marker as a sliver. The caller
    // overlaps the two circles instead, and gets a proper blob.
    expect(metaballShape({ x: 0, y: 0 }, 20, { x: 2.6, y: 1.6 }, 18)).toBeNull();
    expect(metaballShape(at(0), 20, at(8), 20)).toBeNull();
    // Just past it, the join is back.
    expect(metaballShape(at(0), 20, at(18), 20)).toBeTruthy();
  });

  it('refuses zero and negative radii rather than emitting NaN', () => {
    expect(metaballPath(at(0), 0, at(40), 20)).toBeNull();
    expect(metaballPath(at(0), 20, at(40), -3)).toBeNull();
    expect(metaballPath(at(0), 20, at(0), 20)).toBeNull();
  });

  it('never emits a non-finite number', () => {
    for (let gap = 1; gap < 140; gap += 1) {
      for (const r2 of [4, 11, 20]) {
        const d = metaballPath(at(0), 20, at(gap), r2);
        if (!d) continue;
        expect(numbersIn(d).every(Number.isFinite), `gap ${gap} r ${r2}`).toBe(true);
      }
    }
  });

  it('keeps the whole shape within reach of the two bodies', () => {
    // A stray control point is what produces a spike shooting off the bar.
    const d = metaballPath(at(0), 20, at(60), 14)!;
    const nums = numbersIn(d);
    const xs = nums.filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeGreaterThan(-30);
    expect(Math.max(...xs)).toBeLessThan(90);
  });

  it('narrows the neck as the bodies separate', () => {
    // Measured on the curves themselves: the gap between the upper and lower
    // sides of the neck at its midpoint. This is what makes the shape read as
    // liquid rather than as a capsule, so it has to shrink with distance.
    const neckWidth = (gap: number) => {
      const s = metaballShape(at(0), 20, at(gap), 20)!;
      const top = cubicAt(s.p1, s.h1a, s.h2a, s.p3, 0.5);
      const bottom = cubicAt(s.p4, s.h2b, s.h1b, s.p2, 0.5);
      return Math.abs(top.y - bottom.y);
    };
    expect(neckWidth(30)).toBeGreaterThan(neckWidth(70));
    expect(neckWidth(70)).toBeGreaterThan(neckWidth(110));
  });

  it('keeps the neck thinner than the bodies it joins', () => {
    // A neck as wide as the ends is just a capsule with a bulge.
    const s = metaballShape(at(0), 20, at(64), 20)!;
    const top = cubicAt(s.p1, s.h1a, s.h2a, s.p3, 0.5);
    const bottom = cubicAt(s.p4, s.h2b, s.h1b, s.p2, 0.5);
    expect(Math.abs(top.y - bottom.y)).toBeLessThan(2 * 20);
  });
});

describe('circlePath', () => {
  it('draws a closed circle', () => {
    const d = circlePath(at(50, 20), 10);
    expect(d).toMatch(/^M 40\.00 20\.00 a/);
    expect(d).toMatch(/Z$/);
  });

  it('draws nothing for a radius that has faded away', () => {
    expect(circlePath(at(0), 0)).toBe('');
    expect(circlePath(at(0), -2)).toBe('');
  });
});
