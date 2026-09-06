import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, RotateCcw } from 'lucide-react';
import { TourScene } from './TourScenes';
import { preloadScene } from './sceneLoaders';
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
/** How long to wait for a target that has not rendered yet before skipping it.
 *  Generous on purpose: the Plan and Home cards only exist once their data has
 *  arrived, and a sleeping backend can take several seconds to answer. */
const LOCATE_TIMEOUT_MS = 8000;
const LOCATE_INTERVAL_MS = 50;
/** If a screen is still loading after this long, show the card anyway,
 *  centred, so the tour never looks frozen; the spotlight joins it once the
 *  element exists. */
const EARLY_CARD_MS = 350;

/**
 * Spotlights on the real screens.
 *
 * The welcome slideshow says what the app does; this shows where. Each step
 * names a route and a real element. The engine navigates there, waits for the
 * element to exist, scrolls it into view, cuts a hole in a dim backdrop around
 * it and parks an explanation beside it. Moving between steps animates the
 * hole across the screen rather than blinking.
 *
 * The card is a dark panel: an animated scene on top, the copy beneath, and a
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
  const [box, setBox] = useState<Box | null>(null);
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
  }, []);

  // Get to the step's screen, find its element, frame it.
  useEffect(() => {
    let cancelled = false;
    let poll: number | undefined;
    let raf = 0;
    let follow: number | undefined;

    if (location.pathname !== step.route) {
      navigate(step.route);
      return; // this effect re-runs once the route changes
    }

    const started = Date.now();
    let shownEarly = false;

    const found = (el: Element) => {
      targetRef.current = el;
      setTarget(el);
      // Instant, not smooth: the page is blurred while the tour is up, so a
      // smooth scroll is motion nobody can see, and waiting for it to finish
      // was most of the gap between a tap and the next card. The element goes
      // to the edge opposite the card - top of the screen for a card below it,
      // bottom for a card above - which is what leaves a tall target and the
      // card room to sit side by side. Fixed elements are unaffected.
      el.scrollIntoView({ block: step.placement === 'below' ? 'start' : 'end', behavior: 'instant' });
      // scrollIntoView lands flush against the scrollport edge; keep the
      // page's own 16px of air between the element and the bar beside it.
      const scroller = el.closest('main.app-content');
      if (scroller) scroller.scrollTop += step.placement === 'below' ? -16 : 16;
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
      if (!shownEarly && waited > EARLY_CARD_MS) {
        // The screen is still loading. Put the card up now so there is
        // something to read; it glides into place once the target exists.
        shownEarly = true;
        setBox(null);
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

  // Have the next step's animation parsed before it is asked for.
  useEffect(() => {
    const next = TOUR_STEPS[index + 1];
    if (next) preloadScene(next.scene);
  }, [index]);

  // The card's real height drives placement. Measured by an observer rather
  // than read from the ref during render, and re-measured whenever the step
  // (and so the copy length) changes.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCardH(el.offsetHeight));
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
  const EDGE = 12;
  const GAP = 14;
  const spaceBelow = box ? vh - (box.top + box.height) : vh;
  const spaceAbove = box ? box.top : 0;
  const wantBelow = step.placement === 'below';
  const placeBelow = box
    ? wantBelow
      ? spaceBelow >= cardH + GAP || spaceBelow >= spaceAbove
      : !(spaceAbove >= cardH + GAP || spaceAbove >= spaceBelow)
    : true;
  let cardTop = box
    ? placeBelow
      ? box.top + box.height + GAP
      : box.top - GAP - cardH
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
    if (!box) return outer;
    const { top: y, left: x, width: w, height: h } = box;
    const r = step.shape === 'pill' ? Math.min(w, h) / 2 : 16;
    const inner =
      `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} ` +
      `A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} ` +
      `V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`;
    return `${outer} ${inner}`;
  })();

  const spotlightStyle: React.CSSProperties | undefined = box
    ? {
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
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
      <div
        className={`tour-blur ${ready ? 'is-ready' : ''}`}
        style={{ clipPath: `path(evenodd, "${holePath}")` }}
        aria-hidden="true"
      />

      {/* The hole: one box with an enormous shadow. Moving the box moves the
          spotlight, and a CSS transition carries it smoothly between steps. */}
      <div
        className={`tour-spotlight ${ready && box ? 'is-ready' : ''}`}
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
          <TourScene name={step.scene} accent={step.accent} />
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
