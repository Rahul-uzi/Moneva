import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { traceMetaball, type Pt } from './metaball';
import './LiquidGlassNav.css';

export interface LiquidNavItem {
  /** Stable identity, also used as the React key. */
  key: string;
  label: string;
  icon: React.ReactNode;
}

export interface LiquidGlassNavProps {
  items: LiquidNavItem[];
  /** -1 when the current screen has no tab of its own. */
  activeIndex: number;
  onChange: (index: number, item: LiquidNavItem) => void;
  /** Renders an extra control after this index - a raised action button, say. */
  centerAfter?: number;
  centerSlot?: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

/* ---------------------------------------------------------------- timing */

/** A longer hop takes longer, within the range that still feels immediate. */
const travelFor = (distance: number) => Math.min(540, Math.max(380, 360 + Math.abs(distance) * 0.5));
/** How long the dart is when fully drawn out, as a multiple of the resting
 *  radius. Near enough constant whatever the distance: the liquid does not get
 *  longer for a longer trip, it just travels further.
 *
 *  It also cannot exceed what the join will bear. The metaball gives up past
 *  (r1 + r2) * 3.4, and both ends are thinned to a fraction of themselves in
 *  flight - so an over-long dart snaps into two dots rather than stretching
 *  into a filament. At the thicknesses below the join holds to about 1.8. */
const DART_LENGTH = 1.4;
/** How thin each end gets in flight, against its resting radius.
 *
 *  Deliberately lopsided. Thinning both ends equally gives a dumbbell - two
 *  bulges either side of a pinch - which reads as lumpy rather than fast. With
 *  the mass at the front and the back drawn to almost nothing, the same
 *  geometry reads as a comet, which is what the reference actually shows. */
const DART_LEAD = 0.44;
const DART_TAIL = 0.13;
/** The fraction of the journey spent deforming before anything travels. */
const WIND_UP = 0.12;
/** How quickly the body thins into a filament once it sets off. */
const THIN_BY = 0.32;
/** When the head starts swelling into the destination. */
const SWELL_FROM = 0.6;
/** Where the trailing end starts closing the gap. */
const CATCH_UP_FROM = 0.62;
/** Width of the soft halo painted around the liquid. */
const HALO_WIDTH = 7;
/** The well behind each icon, against the resting radius. Slightly smaller, so
 *  the liquid sits proud of the seat it fills rather than dropping into it. */
const WELL_SCALE = 0.88;
/** The wire the wells are threaded on. */
const WIRE_WIDTH = 1.5;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
const easeInOutCubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
/** A restrained overshoot: enough to feel elastic, not enough to bounce. */
const easeOutBack = (p: number, c = 1.12) => {
  const q = p - 1;
  return 1 + (c + 1) * q * q * q + c * q * q;
};

/**
 * A glass bar whose active marker is one body of liquid that flows between
 * items, thins to a dart as it crosses, and pools again at its destination.
 *
 * The marker is not an element sliding on transforms. Every frame the component
 * works out where the leading and trailing halves of the liquid are and draws
 * the single outline enclosing both - a real metaball, so the join bulges near
 * each body and narrows in the middle.
 *
 * The character comes from the radii rather than the path: leaving a tab the
 * body thins to about a quarter of its size, so what crosses the bar is a
 * slim dart rather than a blob dragging a neck, and it swells back out only as
 * it arrives. That is the shape in the reference this was built to - and the
 * reason there is no scattering of droplets behind it.
 *
 * It draws to a canvas rather than to SVG. The same geometry as an SVG path
 * meant writing a fresh `d` attribute every frame, which makes the engine
 * re-parse and re-tessellate the path each time; measured on a Galaxy A33 that
 * ran at about 50fps. Tracing straight onto a canvas skips the DOM entirely.
 *
 * Positions come from measuring the items, so it works for any number of them
 * at any width. A tap during a journey re-aims from where the liquid actually
 * is - both ends of it - so tapping through three tabs quickly reads as one
 * body redirecting rather than snapping back.
 */
export const LiquidGlassNav: React.FC<LiquidGlassNavProps> = ({
  items,
  activeIndex,
  onChange,
  centerAfter,
  centerSlot,
  className = '',
  ariaLabel = 'Main',
}) => {
  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintRef = useRef({
    liquid: '#2F6BFF',
    halo: 'rgba(76, 141, 255, 0.3)',
    bloom: 'rgba(76, 141, 255, 0.5)',
    well: 'rgba(255, 255, 255, 0.05)',
    wire: 'rgba(255, 255, 255, 0.1)',
  });
  /** Every item's centre, for the wells and the wire. Measured with the rest,
   *  never per frame. */
  const centresRef = useRef<number[]>([]);

  const [box, setBox] = useState({ w: 0, h: 0 });
  const [target, setTarget] = useState<number | null>(null);

  /** Where the liquid actually is - both ends - so a mid-flight tap continues
   *  from here rather than snapping back to the tab it started from. */
  const leadRef = useRef<number | null>(null);
  const trailRef = useRef<number | null>(null);
  const rafRef = useRef(0);

  /** Radius of a settled droplet, from the bar's height. */
  const radius = useMemo(() => Math.max(15, Math.min(24, box.h * 0.36)), [box.h]);
  /** The liquid sits on the icons, which ride above the label. */
  const centreY = useMemo(() => box.h / 2 - 8, [box.h]);

  /** The theme's colours, read from the bar so the stylesheet stays the one
   *  place they are defined - and re-read on a theme change, not per frame. */
  const readPaint = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const cs = getComputedStyle(nav);
    const liquid = cs.getPropertyValue('--nav-liquid').trim();
    const halo = cs.getPropertyValue('--nav-halo').trim();
    const bloom = cs.getPropertyValue('--nav-bloom').trim();
    const well = cs.getPropertyValue('--nav-well').trim();
    const wire = cs.getPropertyValue('--nav-wire').trim();
    if (liquid) paintRef.current.liquid = liquid;
    if (halo) paintRef.current.halo = halo;
    if (bloom) paintRef.current.bloom = bloom;
    if (well) paintRef.current.well = well;
    if (wire) paintRef.current.wire = wire;
  }, []);

  const measure = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const navBox = nav.getBoundingClientRect();
    setBox({ w: navBox.width, h: navBox.height });
    readPaint();
    centresRef.current = itemRefs.current.map((item) => {
      if (!item) return 0;
      const r = item.getBoundingClientRect();
      return r.left - navBox.left + r.width / 2;
    });
    const el = activeIndex >= 0 ? itemRefs.current[activeIndex] : null;
    if (!el) {
      setTarget(null);
      return;
    }
    const itemBox = el.getBoundingClientRect();
    setTarget(itemBox.left - navBox.left + itemBox.width / 2);
  }, [activeIndex, readPaint]);

  useEffect(() => {
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [measure]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(nav);
    window.addEventListener('resize', measure);
    // The palette changes when the theme is stamped on <html>.
    const mo = new MutationObserver(() => readPaint());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, readPaint]);

  /** Match the backing store to the display, so the edges stay crisp. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || box.w === 0) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(box.w * dpr);
    canvas.height = Math.round(box.h * dpr);
    const ctx = canvas.getContext('2d');
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [box.w, box.h]);

  /** One frame. */
  const draw = useCallback(
    (lead: Pt, leadR: number, trail: Pt, trailR: number) => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, box.w, box.h);

      const { liquid, halo, bloom, well, wire } = paintRef.current;

      // The wire first, then the seats it threads: the liquid is then clearly
      // travelling along something rather than floating across a gap.
      const centres = centresRef.current;
      if (centres.length > 1) {
        ctx.strokeStyle = wire;
        ctx.lineWidth = WIRE_WIDTH;
        ctx.beginPath();
        ctx.moveTo(centres[0], centreY);
        ctx.lineTo(centres[centres.length - 1], centreY);
        ctx.stroke();

        const wellR = radius * WELL_SCALE;
        ctx.fillStyle = well;
        ctx.beginPath();
        for (const c of centres) {
          ctx.moveTo(c + wellR, centreY);
          ctx.arc(c, centreY, wellR, 0, Math.PI * 2);
        }
        ctx.fill();
      }

      const path = new Path2D();
      // A false return means either the thread has snapped or the two are
      // nearly on top of each other. Two circles cover both: overlapping they
      // read as one blob, far apart as two - which is what the liquid is doing.
      if (!traceMetaball(path, trail, trailR, lead, leadR)) {
        path.moveTo(lead.x + leadR, lead.y);
        path.arc(lead.x, lead.y, leadR, 0, Math.PI * 2);
        path.moveTo(trail.x + trailR, trail.y);
        path.arc(trail.x, trail.y, trailR, 0, Math.PI * 2);
      }
      // Bloom: light thrown onto the glass around the bead. Painted first and
      // clipped to the bar's height, so it never bleeds past the edge.
      const glow = ctx.createRadialGradient(
        lead.x,
        lead.y,
        leadR * 0.25,
        lead.x,
        lead.y,
        leadR * 2.6,
      );
      glow.addColorStop(0, bloom);
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(lead.x - leadR * 2.6, 0, leadR * 5.2, box.h);

      // Two halo passes: a wide faint one for the falloff, a tight brighter
      // one for the lit edge. One pass alone reads as an outline.
      ctx.lineJoin = 'round';
      ctx.strokeStyle = halo;
      ctx.lineWidth = HALO_WIDTH * 2;
      ctx.stroke(path);
      ctx.lineWidth = HALO_WIDTH;
      ctx.stroke(path);

      ctx.fillStyle = liquid;
      ctx.fill(path);

      // A lit top-left on the leading body, so it reads as a bead of glass.
      const sheen = ctx.createRadialGradient(
        lead.x - leadR * 0.3,
        lead.y - leadR * 0.4,
        leadR * 0.1,
        lead.x,
        lead.y,
        leadR,
      );
      sheen.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
      sheen.addColorStop(0.55, 'rgba(255, 255, 255, 0.08)');
      sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = sheen;
      ctx.beginPath();
      ctx.arc(lead.x, lead.y, leadR, 0, Math.PI * 2);
      ctx.fill();

      leadRef.current = lead.x;
      trailRef.current = trail.x;
    },
    [box.w, box.h, radius, centreY],
  );

  /** The settled shape: two circles a hair apart, so it is never a perfect
   *  circle but never obviously two either. */
  const settle = useCallback(
    (x: number) => {
      draw({ x, y: centreY }, radius, { x: x - 2.6, y: centreY + 1.6 }, radius * 0.9);
    },
    [draw, centreY, radius],
  );

  /** Nothing to point at: clear the surface. */
  const clear = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    ctx?.clearRect(0, 0, box.w, box.h);
  }, [box.w, box.h]);

  useEffect(() => {
    if (box.w === 0) return;
    if (target === null) {
      clear();
      return;
    }
    const from = leadRef.current;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    if (from === null || reduced) {
      settle(target);
      return;
    }

    const distance = target - from;
    const span = Math.abs(distance);
    // A tap that lands where the liquid already is still runs a frame, so the
    // shape is redrawn settled rather than left mid-stretch.
    const moving = span > 2;
    const travel = moving ? travelFor(span) : 1;
    // The dart keeps roughly the same length however far it goes, so the lag is
    // a share of this trip rather than a fixed fraction of it.
    const lagFraction = moving ? Math.min(0.55, (DART_LENGTH * radius) / span) : 0;
    // The trailing end carries on from where it actually is. Restarting it at
    // the leading end would snap the body compact the instant it is redirected.
    const trailFrom = trailRef.current ?? from - 2.6;
    const start = performance.now();

    const step = (now: number) => {
      const t = now - start;
      const p = clamp01(t / travel);

      // Wind-up: the body deforms towards its destination before it commits.
      const leadP =
        p < WIND_UP
          ? 0.1 * easeOutCubic(p / WIND_UP)
          : 0.1 + 0.9 * easeOutBack(clamp01((p - WIND_UP) / (1 - WIND_UP)));
      const catchUp = easeInOutCubic(clamp01((p - CATCH_UP_FROM) / (1 - CATCH_UP_FROM)));
      const trailP = clamp01(leadP - lagFraction * (1 - catchUp));

      // The whole character of the thing. Setting off, the body thins to about
      // a quarter of its resting size, so what crosses the bar is a slim dart
      // rather than a blob towing a neck; arriving, it swells back out. Taking
      // the larger of "not yet thinned" and "already swelling" keeps both ends
      // full at rest and full again on arrival, with the thin middle between.
      const thin = easeInOutCubic(clamp01(p / THIN_BY));
      const swell = easeOutBack(clamp01((p - SWELL_FROM) / (1 - SWELL_FROM)), 1.2);
      const body = Math.max(1 - thin, swell);
      const leadR = radius * (DART_LEAD + (1 - DART_LEAD) * body);
      const trailR = radius * 0.9 * (DART_TAIL + (1 - DART_TAIL) * body);

      draw(
        { x: from + distance * leadP, y: centreY },
        leadR,
        { x: trailFrom + (target - trailFrom) * trailP, y: centreY },
        trailR,
      );

      if (t < travel) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        settle(target);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, box.w, radius, centreY, draw, settle, clear]);

  return (
    <nav ref={navRef} className={`bottom-nav ${className}`} aria-label={ariaLabel}>
      <canvas ref={canvasRef} className="lgn-canvas" aria-hidden="true" />

      {items.map((item, index) => (
        <React.Fragment key={item.key}>
          <button
            type="button"
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            className={`nav-item ${index === activeIndex ? 'nav-active' : ''}`}
            aria-current={index === activeIndex ? 'page' : undefined}
            onClick={() => onChange(index, item)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </button>
          {centerAfter === index && centerSlot && (
            <div className="nav-quick-wrapper">{centerSlot}</div>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
};
