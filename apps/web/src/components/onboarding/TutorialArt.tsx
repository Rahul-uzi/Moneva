import React from 'react';
import logoMark from '../../assets/logo/MONEVA_Logo_Mark_FullColor.png';
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
        {/* The real brand mark rather than a redrawn one: the hand-built path
            read as a grinning face against the halo rings. */}
        <circle className="tut-halo" cx="110" cy="80" r="58" />
        <image
          className="tut-logo"
          href={logoMark}
          x="46"
          y="30"
          width="128"
          height="108"
          preserveAspectRatio="xMidYMid meet"
        />
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
        {/* Slightly rounded shoulders, otherwise the straight edges read as a
            hexagon rather than a shield. */}
        <path
          className="tut-shield"
          d="M110 26 L154 43 q3 1 3 5 v30 q0 32 -47 50 q-47 -18 -47 -50 V48 q0 -4 3 -5 Z"
        />
        {/* A fingerprint inside the shield. The ridges used to sit outside it,
            where they read as a pair of horns. */}
        <path className="tut-ridge tut-ridge-1" d="M86 98 v-10 q0 -24 24 -24 q24 0 24 24 v10" />
        <path className="tut-ridge tut-ridge-2" d="M95 98 v-8 q0 -16 15 -16 q15 0 15 16 v8" />
        <path className="tut-ridge tut-ridge-3" d="M104 98 v-6 q0 -9 6 -9 q6 0 6 9 v6" />
        <path className="tut-ridge tut-ridge-4" d="M110 76 v22" />
      </>
    )}
  </svg>
);
