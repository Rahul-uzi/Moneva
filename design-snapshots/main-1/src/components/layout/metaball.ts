/**
 * The outline of two circles joined by a liquid neck.
 *
 * Previously the connection was literally a thin rectangle between two round
 * ends, fused by a blur-and-contrast filter. That reads as a bar with caps: the
 * neck has a constant width, the joins are visible, and no amount of blur makes
 * it organic. This returns the real shape instead - a single closed path whose
 * neck bulges where the two bodies meet and narrows in the middle, with the arc
 * of each circle preserved at either end.
 *
 * The construction is the standard metaball one. For each circle we find the
 * two points where the neck should leave its circumference, then join opposite
 * pairs with cubic curves whose handles run along the tangent, so the neck
 * meets each body smoothly rather than at a corner. As the circles separate the
 * neck thins; past `maxSpanRatio` it snaps and the two bodies are drawn apart,
 * which is what liquid does.
 */
export interface Pt {
  x: number;
  y: number;
}

const distance = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const angleTo = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x);
const project = (p: Pt, radians: number, length: number): Pt => ({
  x: p.x + Math.cos(radians) * length,
  y: p.y + Math.sin(radians) * length,
});
const fmt = (p: Pt) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;

export interface MetaballOptions {
  /** How far apart the circles can get before the neck breaks, as a multiple
   *  of the two radii. Larger means a longer, thinner thread. */
  maxSpanRatio?: number;
  /** How far round each circle the neck attaches. Higher wraps more of the
   *  body into the join, giving a fuller, more viscous look. */
  spread?: number;
  /** Curve handle length. Higher bows the neck outward - the difference
   *  between a taut thread and a heavy one. */
  handle?: number;
}

/** The join, as points rather than as text - so its shape can be measured. */
export interface MetaballShape {
  /** Where the neck leaves the first body, above and below. */
  p1: Pt;
  p2: Pt;
  /** Where it meets the second, above and below. */
  p3: Pt;
  p4: Pt;
  /** Bezier handles for the upper (a) and lower (b) sides of the neck. */
  h1a: Pt;
  h2a: Pt;
  h2b: Pt;
  h1b: Pt;
  /** The two centres and radii, so a canvas can arc around them directly. */
  c1: Pt;
  c2: Pt;
  r1: number;
  r2: number;
  /** Angles of p1..p4 from their own centres, for the same reason. */
  a1: number;
  a2: number;
  a3: number;
  a4: number;
  sweep: 0 | 1;
}

/**
 * The geometry of the join, or null when the two are too far apart.
 *
 * Returning null is meaningful: the caller draws the bodies separately, which
 * is the moment the thread snaps.
 */
export function metaballShape(
  c1: Pt,
  r1: number,
  c2: Pt,
  r2: number,
  { maxSpanRatio = 3.4, spread = 0.55, handle = 2.2 }: MetaballOptions = {},
): MetaballShape | null {
  if (r1 <= 0 || r2 <= 0) return null;

  const d = distance(c1, c2);
  const maxSpan = (r1 + r2) * maxSpanRatio;
  // Too far to hold together, or one circle already swallowed by the other.
  if (d <= 0 || d > maxSpan || d <= Math.abs(r1 - r2)) return null;
  // Nearly on top of each other. The construction degenerates here - the two
  // attachment points end up almost the same direction from their centres and
  // the "join" collapses into a thin crescent instead of the union, which is
  // what turned the resting marker into a sliver. At this range the bodies are
  // one blob anyway, so the caller draws them overlapping and gets the union.
  if (d < Math.max(r1, r2) * 0.75) return null;

  const HALF_PI = Math.PI / 2;

  // Where the circles already overlap, the neck starts at the intersection.
  let u1 = 0;
  let u2 = 0;
  if (d < r1 + r2) {
    u1 = Math.acos((r1 * r1 + d * d - r2 * r2) / (2 * r1 * d));
    u2 = Math.acos((r2 * r2 + d * d - r1 * r1) / (2 * r2 * d));
  }

  const between = angleTo(c1, c2);
  const maxSpreadAngle = Math.acos((r1 - r2) / d);

  const a1 = between + u1 + (maxSpreadAngle - u1) * spread;
  const a2 = between - u1 - (maxSpreadAngle - u1) * spread;
  const a3 = between + Math.PI - u2 - (Math.PI - u2 - maxSpreadAngle) * spread;
  const a4 = between - Math.PI + u2 + (Math.PI - u2 - maxSpreadAngle) * spread;

  const p1 = project(c1, a1, r1);
  const p2 = project(c1, a2, r1);
  const p3 = project(c2, a3, r2);
  const p4 = project(c2, a4, r2);

  // Handles shorten as the circles pull apart, so the neck goes taut rather
  // than ballooning outward at full stretch.
  const totalRadius = r1 + r2;
  const grip = Math.min(spread * handle, distance(p1, p3) / totalRadius);
  const eased = grip * Math.min(1, (d * 2) / totalRadius);

  const h1 = r1 * eased;
  const h2 = r2 * eased;

  const c1a = project(p1, a1 - HALF_PI, h1);
  const c1b = project(p2, a2 + HALF_PI, h1);
  const c2a = project(p3, a3 + HALF_PI, h2);
  const c2b = project(p4, a4 - HALF_PI, h2);

  // The far side of each circle is drawn as a real arc, so the bodies keep
  // their roundness however far the neck is stretched.
  const sweep: 0 | 1 = d > r2 ? 1 : 0;

  return {
    p1,
    p2,
    p3,
    p4,
    h1a: c1a,
    h2a: c2a,
    h2b: c2b,
    h1b: c1b,
    c1,
    c2,
    r1,
    r2,
    a1,
    a2,
    a3,
    a4,
    sweep,
  };
}

/**
 * The joined outline as an SVG path, or null when the thread has snapped.
 */
export function metaballPath(
  c1: Pt,
  r1: number,
  c2: Pt,
  r2: number,
  options: MetaballOptions = {},
): string | null {
  const s = metaballShape(c1, r1, c2, r2, options);
  if (!s) return null;
  return [
    `M ${fmt(s.p1)}`,
    `C ${fmt(s.h1a)} ${fmt(s.h2a)} ${fmt(s.p3)}`,
    `A ${s.r2.toFixed(2)} ${s.r2.toFixed(2)} 0 ${s.sweep} 0 ${fmt(s.p4)}`,
    `C ${fmt(s.h2b)} ${fmt(s.h1b)} ${fmt(s.p2)}`,
    `A ${s.r1.toFixed(2)} ${s.r1.toFixed(2)} 0 ${s.sweep} 0 ${fmt(s.p1)}`,
    'Z',
  ].join(' ');
}

/** A point on a cubic bezier, for measuring the neck between its ends. */
export const cubicAt = (a: Pt, h1: Pt, h2: Pt, b: Pt, t: number): Pt => {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: a.x * w0 + h1.x * w1 + h2.x * w2 + b.x * w3,
    y: a.y * w0 + h1.y * w1 + h2.y * w2 + b.y * w3,
  };
};

/**
 * Traces the joined outline onto a canvas path.
 *
 * The same geometry as `metaballPath`, without going through a string and the
 * DOM's path parser - which is what makes this affordable to redraw every
 * frame. Returns false when there is nothing to join, so the caller can fall
 * back to drawing the two bodies as plain circles.
 */
export function traceMetaball(
  ctx: CanvasRenderingContext2D | Path2D,
  c1: Pt,
  r1: number,
  c2: Pt,
  r2: number,
  options: MetaballOptions = {},
): boolean {
  const s = metaballShape(c1, r1, c2, r2, options);
  if (!s) return false;
  ctx.moveTo(s.p1.x, s.p1.y);
  ctx.bezierCurveTo(s.h1a.x, s.h1a.y, s.h2a.x, s.h2a.y, s.p3.x, s.p3.y);
  // Round the far side of each body. Anticlockwise matches the sweep flag the
  // SVG form uses, so both renderers describe the same outline.
  ctx.arc(s.c2.x, s.c2.y, s.r2, s.a3, s.a4, true);
  ctx.bezierCurveTo(s.h2b.x, s.h2b.y, s.h1b.x, s.h1b.y, s.p2.x, s.p2.y);
  ctx.arc(s.c1.x, s.c1.y, s.r1, s.a2, s.a1, true);
  ctx.closePath();
  return true;
}

/** A plain circle as a path, for a body with nothing to connect to. */
export function circlePath(c: Pt, r: number): string {
  if (r <= 0) return '';
  return (
    `M ${(c.x - r).toFixed(2)} ${c.y.toFixed(2)} ` +
    `a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(r * 2).toFixed(2)} 0 ` +
    `a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-r * 2).toFixed(2)} 0 Z`
  );
}
