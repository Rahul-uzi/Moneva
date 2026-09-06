import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, RotateCcw, X } from 'lucide-react';
import { Illustration } from '../ui/Illustration';
import { TOUR_STEPS } from './tourSteps';
import { useAuthStore } from '../../stores/useAuthStore';
import './GuidedTour.css';

interface Props {
  onFinish: () => void;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Breathing room around the highlighted element. */
const PAD = 8;

/**
 * The route chunks, so the next one can be fetched while the current card is
 * still being read.
 *
 * The four steps that change route were measured at a 24ms median frame and 27
 * of 54 frames over budget, against 11ms on a step that stays put - the cost
 * of fetching and mounting a lazily loaded screen at the exact moment of the
 * transition. Warming it a card early moves that work into the reading pause,
 * where nothing is animating.
 *
 * These resolve to the same modules App.tsx lazy-loads, so this shares its
 * chunks rather than adding any.
 */
const ROUTE_CHUNK: Record<string, () => Promise<unknown>> = {
  '/': () => import('../../pages/HomePage'),
  '/activity': () => import('../../pages/ActivityPage'),
  '/plan': () => import('../../pages/PlanPage'),
  '/assistant': () => import('../../pages/AssistantPage'),
};
/** How long to wait for a target that has not rendered yet before skipping it.
 *  Generous on purpose: the Plan and Home cards only exist once their data has
 *  arrived, and a sleeping backend can take several seconds to answer. */
const LOCATE_TIMEOUT_MS = 8000;
const LOCATE_INTERVAL_MS = 50;
/** If a screen is still loading after this long, show the card anyway,
 *  centred, so the tour never looks frozen; the spotlight joins it once the
 *  element exists.
 *
 *  Five frames. It was 350ms, which on the four steps that change route -
 *  where the screen is a lazily loaded chunk - left the card at opacity 0 for
 *  over half a second after the tap: measured at 500ms of nothing on screen
 *  but a flat dim. Long enough to read as the tour having broken. The window
 *  still needs to be non-zero, or a target that arrives on the very next frame
 *  would put the card up centred and then glide it for no reason. */
const EARLY_CARD_MS = 80;
/** Between the card and the element it points at. */
const GAP = 14;
/** The closest the card ever comes to a screen edge. */
const EDGE = 12;

/**
 * Scroll `el` to the middle of the strip of screen the card does not occupy.
 *
 * The card sits either above or below the target, so the target's usable
 * screen is only the part left over. Centring in the viewport instead - the
 * obvious reading of "bring it to the centre" - puts the element exactly where
 * the card wants to be, and on a phone there is then no room for the card on
 * either side of it.
 *
 * Instant, not smooth: the page is blurred while the tour is up, so a smooth
 * scroll is motion nobody can see, and waiting for one to finish was most of
 * the delay between a tap and the next card.
 */
const centreInFreeBand = (el: Element, placement: 'above' | 'below', cardH: number): void => {
  const vh = window.innerHeight;
  const rect = el.getBoundingClientRect();

  // A fixed element - the dock, the header - is already where it will be, and
  // scrolling would only move the page behind it.
  let node: Element | null = el;
  while (node && node !== document.body) {
    if (getComputedStyle(node).position === 'fixed') return;
    node = node.parentElement;
  }

  // The band the card leaves free, and where its middle falls.
  const band = placement === 'below'
    ? { top: EDGE, bottom: vh - cardH - GAP }
    : { top: cardH + GAP, bottom: vh - EDGE };

  // A target taller than the band cannot be centred in it; show its top.
  const height = rect.height + PAD * 2;
  const want = height >= band.bottom - band.top
    ? band.top + height / 2
    : (band.top + band.bottom) / 2;

  const delta = (rect.top + rect.height / 2) - want;
  if (Math.abs(delta) < 1) return;

  const scroller = el.closest('main.app-content') as HTMLElement | null;
  if (scroller) scroller.scrollTop += delta;
  else window.scrollBy({ top: delta, behavior: 'instant' as ScrollBehavior });
};

/**
 * Spotlights on the real screens.
 *
 * The welcome slideshow says what the app does; this shows where. Each step
 * names a route and a real element. The engine navigates there, waits for the
 * element to exist, scrolls it into view, cuts a hole in a dim backdrop around
 * it and parks an explanation beside it. Moving between steps animates the
 * hole across the screen rather than blinking.
 *
 * The card is a dark panel: a drawing on top, the copy beneath, and a
 * Restart / n of N / Next row along the bottom. Dark in both themes on
 * purpose - it is a guide laid over the app, not part of the page.
 *
 * Targets that never appear (a card that only renders with data) are skipped
 * after a short wait, so a fresh account with nothing in it still gets a
 * complete tour instead of a stuck one.
 */
export const GuidedTour: React.FC<Props> = ({ onFinish }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  // The last geometry the hole was given. Deliberately NOT cleared between
  // steps: when the next step has no target yet, the hole closes onto the
  // middle of this rather than disappearing (see holePath).
  const [box, setBox] = useState<Box | null>(null);
  // Whether `box` belongs to the step currently on screen.
  const [hasTarget, setHasTarget] = useState(false);
  const [ready, setReady] = useState(false);
  const [early, setEarly] = useState(false);
  const targetRef = useRef<Element | null>(null);
  // The same element as state, so the observers below re-subscribe when a
  // slow screen delivers its target after the card is already up.
  const [target, setTarget] = useState<Element | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const frostedRef = useRef<Set<Element>>(new Set());
  const [cardH, setCardH] = useState(370);
  // The same value for the scroll helper, which runs inside an effect that
  // must not re-run when the card is re-measured.
  const cardHRef = useRef(370);
  // Set when this step had to change screen. On the run straight after a
  // navigation there is no point waiting to see whether the target turns up:
  // the screen it lives on is still being built.
  const justNavigatedRef = useRef(false);
  const touchStartX = useRef<number | null>(null);

  const step = TOUR_STEPS[index];
  const isLast = index === TOUR_STEPS.length - 1;
  const firstName = (user?.display_name || '').trim().split(/\s+/)[0];

  const goTo = useCallback(
    (next: number) => {
      if (next < 0) return;
      if (next >= TOUR_STEPS.length) {
        onFinish();
        return;
      }
      setDirection(next > index ? 1 : -1);
      // Each step starts with no target: measuring the previous screen's
      // element while the next one loads would cut a hole around nothing.
      targetRef.current = null;
      setTarget(null);
      setReady(false);
      setEarly(false);
      setIndex(next);
    },
    [index, onFinish],
  );

  const measure = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setBox({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
    setHasTarget(true);
  }, []);

  // Get to the step's screen, find its element, frame it.
  useEffect(() => {
    let cancelled = false;
    let poll: number | undefined;
    let raf = 0;
    let follow: number | undefined;

    if (location.pathname !== step.route) {
      justNavigatedRef.current = true;
      navigate(step.route);
      return; // this effect re-runs once the route changes
    }
    const arrivedOnNewScreen = justNavigatedRef.current;
    justNavigatedRef.current = false;

    const started = Date.now();
    let shownEarly = false;

    const found = (el: Element) => {
      targetRef.current = el;
      setTarget(el);
      // Bring the element to the middle of the screen the card leaves free,
      // rather than the middle of the whole screen. Those are not the same
      // place: the card is about 370px of an 850px phone, so an element
      // centred in the viewport has roughly half a card's worth of room on
      // either side of it - too little for the card, which then gets clamped
      // against the screen edge and comes to rest on top of the very thing it
      // is describing.
      //
      // Centring it in the free band instead reads the same way to someone
      // holding the phone - the section is in the middle of what they can see
      // - and leaves the card its full height below (or above) the target.
      centreInFreeBand(el, step.placement, cardHRef.current);
      raf = requestAnimationFrame(() => {
        if (cancelled) return;
        measure();
        setReady(true);
        // Entrance animations (translateY) move the element without firing
        // scroll or resize, so keep re-measuring until they have finished.
        let ticks = 0;
        follow = window.setInterval(() => {
          ticks += 1;
          if (cancelled || ticks > 8) {
            clearInterval(follow);
            return;
          }
          measure();
        }, 100);
      });
    };

    const locate = () => {
      if (cancelled) return;
      const el = document.querySelector(step.selector);
      if (el) {
        found(el);
        return;
      }
      const waited = Date.now() - started;
      // Straight after a navigation, put the card up on the first miss: the
      // screen is definitely still loading, so the grace period is only
      // deciding how long to show nothing. It halved the gap between the tap
      // and the card on the four steps that change screen.
      if (!shownEarly && (arrivedOnNewScreen || waited > EARLY_CARD_MS)) {
        // The screen is still loading. Put the card up now so there is
        // something to read; it glides into place once the target exists.
        shownEarly = true;
        setHasTarget(false);
        setEarly(true);
        setReady(true);
      }
      if (waited > LOCATE_TIMEOUT_MS) {
        // Nothing to point at on this account; move on rather than hang.
        goTo(index + (direction >= 0 ? 1 : -1));
        return;
      }
      poll = window.setTimeout(locate, LOCATE_INTERVAL_MS);
    };
    locate();

    return () => {
      cancelled = true;
      if (poll) clearTimeout(poll);
      if (raf) cancelAnimationFrame(raf);
      if (follow) clearInterval(follow);
    };
    // `direction` is read for the skip fallback only; re-running on it would
    // re-locate for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, location.pathname, step.route, step.selector, navigate, measure, goTo]);

  // Fetch the next step's screen while this one is being read.
  //
  // Only the chunk: mounting it early would run another page's effects and its
  // data fetching underneath the tour. This just puts the module in memory so
  // the navigation is a render rather than a network round trip.
  useEffect(() => {
    const next = TOUR_STEPS[index + 1];
    if (!next || next.route === step.route) return;
    const warm = ROUTE_CHUNK[next.route];
    if (!warm) return;
    // After the current step has settled, so the fetch cannot compete with
    // the transition that is running right now.
    const id = window.setTimeout(() => {
      void warm().catch(() => {
        /* offline, or the chunk is already gone from the server - the normal
           lazy load will surface it */
      });
    }, 400);
    return () => clearTimeout(id);
  }, [index, step.route]);

  // Frost the page around the step's target.
  //
  // Not a backdrop-filter over the top: that is recomputed on every frame the
  // page produces, and with a scene animating in the card that is every frame,
  // which cost about a quarter of the frame budget on a mid-range phone for a
  // picture that never changes. A plain filter on the page's own elements is
  // rasterised once and then just composited, so it is free to hold.
  //
  // Everything is blurred except the chain of elements from the root down to
  // the target, which leaves the spotlit element - and only it - sharp.
  useEffect(() => {
    if (!ready) return;
    const overlay = overlayRef.current;
    const root = document.querySelector('.app-viewport');
    if (!overlay || !root) return;
    const want = new Set<Element>();
    const add = (el: Element) => {
      if (el === overlay || el.contains(overlay)) return;
      want.add(el);
    };
    if (target && root.contains(target)) {
      let node: Element | null = target;
      while (node && node !== root) {
        const parent: Element | null = node.parentElement;
        if (!parent) break;
        for (const sib of Array.from(parent.children)) if (sib !== node) add(sib);
        node = parent;
      }
    } else {
      // No target yet (a screen still loading): frost the whole page.
      for (const child of Array.from(root.children)) add(child);
    }

    // Only touch what actually changed. Consecutive steps on the same screen
    // share most of their frosted elements, and adding or removing the class
    // makes the browser re-blur that whole subtree - doing it to all of them
    // on every step was the one remaining stutter.
    const have = frostedRef.current;
    for (const el of have) if (!want.has(el)) el.classList.remove('tour-frost');
    for (const el of want) if (!have.has(el)) el.classList.add('tour-frost');
    frostedRef.current = want;
  }, [ready, target, index]);

  // Un-frost the page when the tour closes, however it closes.
  useEffect(
    () => () => {
      for (const el of frostedRef.current) el.classList.remove('tour-frost');
      frostedRef.current = new Set();
    },
    [],
  );

  // The card's real height drives placement. Measured by an observer rather
  // than read from the ref during render, and re-measured whenever the step
  // (and so the copy length) changes.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setCardH(el.offsetHeight);
      cardHRef.current = el.offsetHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [step.id]);

  // Keep the hole on the element if the layout shifts under it.
  useEffect(() => {
    if (!ready) return;
    const onChange = () => measure();
    window.addEventListener('resize', onChange);
    const scroller = document.querySelector('main.app-content');
    scroller?.addEventListener('scroll', onChange, { passive: true });
    const ro = target ? new ResizeObserver(onChange) : null;
    if (ro && target) ro.observe(target);
    return () => {
      window.removeEventListener('resize', onChange);
      scroller?.removeEventListener('scroll', onChange);
      ro?.disconnect();
    };
  }, [ready, target, measure]);

  // Swipe and keyboard, matching the slideshow.
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 45) return;
    goTo(delta < 0 ? index + 1 : index - 1);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goTo(index + 1);
      if (e.key === 'ArrowLeft') goTo(index - 1);
      if (e.key === 'Escape') onFinish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, goTo, onFinish]);

  // Card placement: honour the step's preference unless there is no room,
  // and never let the card leave the screen. With the scene on top the card
  // is ~370px tall; a target in the middle of the screen can have less than
  // that on either side, and an unclamped card sat with its top cut off.
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  // Only a box that belongs to the step on screen can place the card; a stale
  // one would park it beside an element the copy is not about.
  const live = hasTarget ? box : null;
  const spaceBelow = live ? vh - (live.top + live.height) : vh;
  const spaceAbove = live ? live.top : 0;
  const wantBelow = step.placement === 'below';
  const placeBelow = live
    ? wantBelow
      ? spaceBelow >= cardH + GAP || spaceBelow >= spaceAbove
      : !(spaceAbove >= cardH + GAP || spaceAbove >= spaceBelow)
    : true;
  let cardTop = live
    ? placeBelow
      ? live.top + live.height + GAP
      : live.top - GAP - cardH
    : vh / 2 - cardH / 2;
  cardTop = Math.max(EDGE, Math.min(cardTop, vh - cardH - EDGE));
  const cardStyle: React.CSSProperties = { top: cardTop };

  // A frosted layer over everything except the target. backdrop-filter has
  // no notion of a hole, so the layer is clipped with an even-odd path: the
  // whole viewport minus the spotlight shape. The shape's corner radius (or
  // the full circle for pill targets) matches the ring above it.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 400;
  const holePath = (() => {
    const outer = `M0 0 H${vw} V${vh} H0 Z`;

    // The hole is ALWAYS drawn, even when there is no target.
    //
    // A clip-path only animates between two paths that have the same commands
    // in the same order. Returning the bare outer rectangle when there was no
    // box meant the path went from fifteen commands to five and back, which
    // CSS cannot interpolate - so it fell back to a discrete swap and the
    // spotlight snapped shut and snapped open. Measured on the step that
    // changes route: the hole vanished at 468ms and did not return until
    // 1208ms, three quarters of a second of flat dim, twice interrupted by a
    // jump. That is the backdrop "breaking".
    //
    // With no box the hole collapses onto the middle of wherever it last was,
    // so it closes and reopens smoothly instead.
    const b =
      hasTarget && box
        ? box
        : box
          ? { top: box.top + box.height / 2, left: box.left + box.width / 2, width: 0, height: 0 }
          : { top: vh / 2, left: vw / 2, width: 0, height: 0 };

    const { top: y, left: x, width: w, height: h } = b;
    // Never more than half the shorter side, or the corner arcs overlap and
    // the rounded rectangle turns inside out on a small target.
    const r = Math.min(step.shape === 'pill' ? Math.min(w, h) / 2 : 16, w / 2, h / 2);
    const inner =
      `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} ` +
      `A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} ` +
      `V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`;
    return `${outer} ${inner}`;
  })();

  const spotlightStyle: React.CSSProperties | undefined = live
    ? {
        top: live.top,
        left: live.left,
        width: live.width,
        height: live.height,
        borderRadius: step.shape === 'pill' ? 999 : 16,
      }
    : undefined;

  const title = step.greeting && firstName ? `Hey ${firstName}!` : step.title;
  const body = step.greeting && firstName ? `${step.title}. ${step.body}` : step.body;

  return (
    <div
      ref={overlayRef}
      className="tour-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Guided tour"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Dims everything but the target. The soft focus itself is applied to
          the page's own elements (see the frost effect above), so this layer
          only has to carry the colour and the hole. */}
      {/* Tapping the dimmed area leaves the tour. Past the first step the
          only control was "Restart", so on a phone - where there is no Escape
          key - someone who wanted out had to press Next to the end. The tour
          can always be replayed from Profile, so leaving is cheap. */}
      <div
        className={`tour-blur ${ready ? 'is-ready' : ''}`}
        style={{ clipPath: `path(evenodd, "${holePath}")` }}
        onClick={onFinish}
        aria-hidden="true"
      />

      {/* The hole: one box with an enormous shadow. Moving the box moves the
          spotlight, and a CSS transition carries it smoothly between steps. */}
      <div
        className={`tour-spotlight ${ready && live ? 'is-ready' : ''}`}
        style={spotlightStyle}
        aria-hidden="true"
      >
        <span className="tour-spotlight-ring" style={{ borderRadius: step.shape === 'pill' ? 999 : 19 }} />
      </div>

      {/* Keyed on the step so its entrance replays and the scene starts over. */}
      <div
        key={step.id}
        ref={cardRef}
        className={`tour-card ${direction > 0 ? 'tour-card-from-right' : 'tour-card-from-left'} ${ready ? 'is-ready' : ''} ${early ? 'tour-card-glide' : ''}`}
        style={cardStyle}
      >
        <div className="tour-scene">
          <Illustration name={step.scene} />
          {/* A way out on every step, not just the first.
              The button on the left of the action row says "Skip" on step 1
              and "Restart" from step 2 on, which left the middle of the tour
              with no visible exit at all - the dimmed area does dismiss it,
              but nothing says so. This is the one control that means leave,
              and it never moves. */}
          <button
            type="button"
            className="tour-close"
            onClick={onFinish}
            aria-label="Close tour"
          >
            <X size={16} />
          </button>
          <span className="tour-scene-badge">
            {index + 1}/{TOUR_STEPS.length}
          </span>
        </div>

        <div className="tour-copy">
          <h3 className="tour-title">{title}</h3>
          <p className="tour-text">{body}</p>
        </div>

        <div className="tour-dots" role="tablist" aria-label="Tour progress">
          {TOUR_STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Step ${i + 1}: ${s.title}`}
              className={i === index ? 'tour-dot is-active' : i < index ? 'tour-dot is-done' : 'tour-dot'}
              onClick={() => goTo(i)}
            />
          ))}
        </div>

        {/* Restart · n of N · Next - and Back once there is somewhere to go. */}
        <div className="tour-actions">
          <button
            type="button"
            className="tour-btn tour-btn-text"
            onClick={() => (index === 0 ? onFinish() : goTo(0))}
            aria-label={index === 0 ? 'Skip tour' : 'Restart tour'}
          >
            {index === 0 ? 'Skip' : (
              <>
                <RotateCcw size={14} /> Restart
              </>
            )}
          </button>
          <span className="tour-counter">
            {index + 1} of {TOUR_STEPS.length}
          </span>
          {index > 0 && (
            <button
              type="button"
              className="tour-btn tour-btn-icon"
              onClick={() => goTo(index - 1)}
              aria-label="Previous step"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <button type="button" className="tour-btn tour-btn-primary" onClick={() => goTo(index + 1)}>
            {isLast ? (
              <>
                <Check size={16} /> Done
              </>
            ) : (
              <>
                Next <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GuidedTour;
