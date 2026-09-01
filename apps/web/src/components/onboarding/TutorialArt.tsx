import React from 'react';
import './TutorialArt.css';

export type TutorialArtName = 'welcome' | 'track' | 'plan' | 'bills' | 'secure';

/**
 * Spot illustrations for the walkthrough.
 *
 * Inline SVG rather than image assets: they add no download weight, stay sharp
 * at any density, follow the MONEVA palette through CSS variables, and the
 * parts that move are animated with transform/opacity only. Every animation is
 * disabled under prefers-reduced-motion (see TutorialArt.css).
 */
export const TutorialArt: React.FC<{ name: TutorialArtName }> = ({ name }) => (
  <svg
    className={`tut-art tut-art-${name}`}
    viewBox="0 0 220 170"
    fill="none"
    role="presentation"
    aria-hidden="true"
  >
    <ellipse className="tut-ground" cx="110" cy="152" rx="66" ry="8" />

    {name === 'welcome' && (
      <>
        <circle className="tut-halo" cx="110" cy="76" r="52" />
        <circle className="tut-halo tut-halo-2" cx="110" cy="76" r="40" />
        {/* The MONEVA mark: a rising line over a cupped hand. */}
        <path className="tut-hand" d="M74 96 q36 30 72 0 q-8 34 -36 34 q-28 0 -36 -34 Z" />
        <polyline className="tut-spark" points="76,88 94,74 110,82 128,58 144,48" />
        <circle className="tut-dot tut-dot-a" cx="76" cy="88" r="5" />
        <circle className="tut-dot tut-dot-b" cx="94" cy="74" r="5" />
        <circle className="tut-dot tut-dot-c" cx="110" cy="82" r="5" />
        <circle className="tut-dot tut-dot-d" cx="128" cy="58" r="5" />
        <circle className="tut-dot tut-dot-e" cx="144" cy="48" r="6" />
      </>
    )}

    {name === 'track' && (
      <>
        <rect className="tut-surface" x="48" y="34" width="124" height="98" rx="12" />
        <rect className="tut-row tut-row-1" x="64" y="54" width="76" height="10" rx="5" />
        <rect className="tut-amt tut-amt-1" x="146" y="54" width="12" height="10" rx="5" />
        <rect className="tut-row tut-row-2" x="64" y="78" width="58" height="10" rx="5" />
        <rect className="tut-amt tut-amt-2" x="146" y="78" width="12" height="10" rx="5" />
        <rect className="tut-row tut-row-3" x="64" y="102" width="66" height="10" rx="5" />
        <rect className="tut-amt tut-amt-3" x="146" y="102" width="12" height="10" rx="5" />
        <circle className="tut-badge" cx="166" cy="40" r="15" />
        <path className="tut-badge-plus" d="M166 33 v14 M159 40 h14" strokeLinecap="round" />
      </>
    )}

    {name === 'plan' && (
      <>
        {/* Bars that grow toward a goal line. */}
        <line className="tut-goal-line" x1="46" y1="52" x2="174" y2="52" strokeDasharray="6 6" />
        <rect className="tut-bar tut-bar-1" x="62" y="60" width="20" height="64" rx="6" />
        <rect className="tut-bar tut-bar-2" x="92" y="60" width="20" height="64" rx="6" />
        <rect className="tut-bar tut-bar-3" x="122" y="60" width="20" height="64" rx="6" />
        <rect className="tut-bar tut-bar-4" x="152" y="60" width="20" height="64" rx="6" />
        <circle className="tut-target" cx="110" cy="52" r="9" />
        <circle className="tut-target-inner" cx="110" cy="52" r="3.5" />
      </>
    )}

    {name === 'bills' && (
      <>
        <rect className="tut-surface" x="56" y="38" width="108" height="94" rx="12" />
        <rect className="tut-cal-head" x="56" y="38" width="108" height="22" rx="12" />
        <circle className="tut-cal-dot" cx="82" cy="82" r="7" />
        <circle className="tut-cal-dot" cx="110" cy="82" r="7" />
        <circle className="tut-cal-dot tut-cal-due" cx="138" cy="82" r="9" />
        <circle className="tut-cal-dot" cx="82" cy="108" r="7" />
        <circle className="tut-cal-dot" cx="110" cy="108" r="7" />
        <g className="tut-bell">
          <path className="tut-bell-body" d="M160 34 a13 13 0 0 1 13 13 v10 l4 6 h-34 l4 -6 v-10 a13 13 0 0 1 13 -13 Z" />
          <path className="tut-bell-clapper" d="M156 67 a5 5 0 0 0 10 0" />
        </g>
      </>
    )}

    {name === 'secure' && (
      <>
        <path className="tut-shield" d="M110 26 L156 44 v34 q0 32 -46 48 q-46 -16 -46 -48 V44 Z" />
        <path className="tut-shield-check" d="M92 76 l13 13 l25 -28" strokeLinecap="round" strokeLinejoin="round" />
        {/* Fingerprint ridges sweeping in behind the shield. */}
        <path className="tut-ridge tut-ridge-1" d="M40 96 q10 -22 26 -28" />
        <path className="tut-ridge tut-ridge-2" d="M34 110 q14 -32 34 -40" />
        <path className="tut-ridge tut-ridge-3" d="M180 96 q-10 -22 -26 -28" />
        <path className="tut-ridge tut-ridge-4" d="M186 110 q-14 -32 -34 -40" />
      </>
    )}
  </svg>
);
