import React from 'react';
import './Illustration.css';

export type IllustrationName =
  // Empty states, one per thing that can be empty.
  | 'wallet'
  | 'ledger'
  | 'chart'
  | 'budget'
  | 'goal'
  | 'calendar'
  | 'bell'
  | 'search'
  // Outcomes.
  | 'success'
  | 'error'
  | 'offline'
  // Tour and onboarding scenes.
  | 'welcome'
  | 'add'
  | 'secure'
  | 'ask';

interface Props {
  name: IllustrationName;
  /** Rendered width in px; height follows the 200:140 canvas. */
  size?: number;
  className?: string;
}

/**
 * The app's drawings.
 *
 * Composed from the reference boards rather than guessed at. What those shots
 * do, and two earlier passes here did not:
 *
 *   1. The drawing sits on its own tinted panel. On transparency, any drawing
 *      reads as a large icon; on a ground of its own it reads as a picture.
 *   2. It is a cluster, not an object. Two or three related things, overlapping,
 *      with a small solid one in front for scale.
 *   3. Nothing is square to the frame. A few degrees of rotation is most of the
 *      difference between an illustration and an icon.
 *   4. The negative space carries scatter - a spark, a couple of dots - so the
 *      frame is composed rather than merely occupied.
 *
 * Two plates as before: every closed shape is drawn twice, a flat fill knocked
 * five pixels out of register with its own ink line. Three values - panel, fill,
 * line - and a contour heavier than the details inside it.
 *
 * Still only voltage and ember.
 */

/**
 * An object with thickness.
 *
 * Three passes: a solid mass offset down-right, the face over it in the
 * ground's own colour, then the outline. The mass only shows along the bottom
 * and right, which is exactly what an extruded edge looks like - and it is
 * what gives the object weight. A faint wash here, which is what this was
 * before, gives none.
 */
const Body: React.FC<{ d: string; dx?: number; dy?: number }> = ({ d, dx = 6, dy = 7 }) => (
  <>
    <path className="illo-extrude" d={d} transform={`translate(${dx} ${dy})`} />
    <path className="illo-face" d={d} />
    <path className="illo-ink" d={d} />
  </>
);

/** A coin: the same construction, seen almost edge-on. */
const Coin: React.FC<{ cx: number; cy: number; rx: number; ry?: number }> = ({
  cx,
  cy,
  rx,
  ry = rx * 0.42,
}) => (
  <>
    <ellipse className="illo-extrude" cx={cx} cy={cy + rx * 0.34} rx={rx} ry={ry} />
    <ellipse className="illo-face" cx={cx} cy={cy} rx={rx} ry={ry} />
    <ellipse className="illo-ink" cx={cx} cy={cy} rx={rx} ry={ry} />
  </>
);

/** What the object is standing on. */
const Shadow: React.FC<{ cx: number; cy: number; rx: number }> = ({ cx, cy, rx }) => (
  <ellipse className="illo-shadow" cx={cx} cy={cy} rx={rx} ry={rx * 0.17} />
);

/**
 * The mark, exactly as Logo.tsx draws it. Kept as the same string rather than
 * redrawn to fit this canvas, so the welcome screen and the launcher icon can
 * never quietly diverge.
 */
const MARK = 'M5 22.5 11 12l5 6.5L21 8l6 14.5';

/** The ground the drawing is composed on. */
const Panel: React.FC = () => (
  <rect className="illo-panel" x="0" y="0" width="200" height="140" rx="20" />
);

/** A four-point spark. The scatter that keeps the corners from going dead. */
const Spark: React.FC<{ x: number; y: number; r: number; className?: string }> = ({
  x,
  y,
  r,
  className,
}) => (
  <path
    className={['illo-spark', className].filter(Boolean).join(' ')}
    d={`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z`}
  />
);

export const Illustration: React.FC<Props> = ({ name, size = 168, className }) => (
  <svg
    className={['moneva-illustration', `illo-${name}`, className].filter(Boolean).join(' ')}
    width={size}
    height={size * 0.7}
    viewBox="0 0 200 140"
    fill="none"
    role="presentation"
    aria-hidden="true"
  >
    <Panel />

    {name === 'wallet' && (
      <>
        {/* A card half out of the wallet, and one coin in front of both. */}
        <g transform="rotate(-9 104 46)">
          <Body d="M72 24 H148 a8 8 0 0 1 8 8 v26 H64 V32 a8 8 0 0 1 8-8 Z" />
          <path className="illo-detail" d="M78 40 h30" />
        </g>
        <g transform="rotate(-3 100 86)">
          <Body d="M46 56 H150 a13 13 0 0 1 13 13 v28 a13 13 0 0 1-13 13 H46 a13 13 0 0 1-13-13 V69 a13 13 0 0 1 13-13 Z" />
          <path className="illo-detail" d="M128 84 h30" />
        </g>
        <circle className="illo-solid" cx="46" cy="40" r="13" />
        <Spark x={178} y={26} r={9} />
        <circle className="illo-dot-soft" cx="176" cy="112" r="4" />
      </>
    )}

    {name === 'ledger' && (
      <>
        {/* Two slips, the one behind showing only its edge. */}
        <g transform="rotate(6 104 74)">
          <Body d="M62 26 H154 a10 10 0 0 1 10 10 V96 a10 10 0 0 1-10 10 H62 a10 10 0 0 1-10-10 V36 a10 10 0 0 1 10-10 Z" />
        </g>
        <g transform="rotate(-4 92 76)">
          <Body d="M38 34 H130 a10 10 0 0 1 10 10 V104 a10 10 0 0 1-10 10 H38 a10 10 0 0 1-10-10 V44 a10 10 0 0 1 10-10 Z" />
          <path className="illo-detail" d="M52 58 H104 M52 76 H90 M52 92 H74" />
          <circle className="illo-solid" cx="116" cy="58" r="8" />
        </g>
        <Spark x={176} y={116} r={9} />
      </>
    )}

    {name === 'chart' && (
      <>
        {/* Columns, and the line that ran over them. */}
        <g className="illo-column illo-column-1">
          <Body d="M40 82 H58 a4 4 0 0 1 4 4 v30 H36 V86 a4 4 0 0 1 4-4 Z" />
        </g>
        <g className="illo-column illo-column-2">
          <Body d="M76 58 H94 a4 4 0 0 1 4 4 v54 H72 V62 a4 4 0 0 1 4-4 Z" />
        </g>
        <g className="illo-column illo-column-3">
          <Body d="M112 94 H130 a4 4 0 0 1 4 4 v18 H108 V98 a4 4 0 0 1 4-4 Z" />
        </g>
        <path className="illo-open" d="M148 44 H166 a4 4 0 0 1 4 4 v68 H144 V48 a4 4 0 0 1 4-4 Z" />
        <path className="illo-detail illo-trace" d="M40 66 L84 42 L120 74 L158 28" />
        <circle className="illo-solid illo-tip" cx="158" cy="28" r="8" />
        <Spark x={26} y={34} r={8} />
      </>
    )}

    {name === 'budget' && (
      <>
        {/* A ring at a reading, with a coin sitting in it.
            This was an arc beside a slip, and the two ran together: the sweep
            drove into the slip and its end cap surfaced alongside as a stray
            stub. Standing the arch over the slip cleared the overlap but drew
            a padlock, which is what step 11 is for.
            A closed ring is the shape a budget actually is - a whole, and how
            much of it has gone - and nothing else in the set is a ring. */}
        <Shadow cx={100} cy={128} rx={48} />
        <circle className="illo-track" cx={100} cy={72} r={40} />
        <path className="illo-value illo-fillup" d="M100 32 A40 40 0 1 1 72.6 101.2" />
        <path className="illo-figure" d="M82 66 h36" />
        <path className="illo-detail" d="M92 84 h16" />
        <Spark x={40} y={26} r={9} />
      </>
    )}

    {name === 'goal' && (
      <>
        {/* Three steps and a flag planted on the top one. A goal is a thing you
            climb to, not a line that goes up. */}
        <Shadow cx={98} cy={124} rx={62} />
        <Body d="M34 92 H74 a6 6 0 0 1 6 6 v18 H28 V98 a6 6 0 0 1 6-6 Z" />
        <Body d="M78 72 H118 a6 6 0 0 1 6 6 v38 H72 V78 a6 6 0 0 1 6-6 Z" />
        <Body d="M122 52 H162 a6 6 0 0 1 6 6 v58 H116 V58 a6 6 0 0 1 6-6 Z" />
        <path className="illo-ink" d="M142 52 V16" />
        <g className="illo-wave">
          <path className="illo-solid-shape" d="M142 18 L108 28 L142 40 Z" />
        </g>
        <Coin cx={44} cy={62} rx={13} />
        <Spark x={30} y={30} r={9} />
      </>
    )}

    {name === 'calendar' && (
      <>
        {/* A block with a date circled on it, tipped off square, with the coins
            the bill will cost tumbling past. */}
        <Shadow cx={94} cy={124} rx={58} />
        <g transform="rotate(-13 94 76)">
          <Body d="M40 38 H142 a11 11 0 0 1 11 11 V104 a11 11 0 0 1-11 11 H40 a11 11 0 0 1-11-11 V49 a11 11 0 0 1 11-11 Z" />
          <path className="illo-ink" d="M30 64 H154" />
          {/* The binding rings pass through the block, so they are drawn over it. */}
          <path className="illo-ink" d="M58 22 v22 M124 22 v22" />
          <path className="illo-detail" d="M46 82 h13 M72 82 h13 M46 98 h13 M98 98 h13" />
          <circle className="illo-solid" cx="111" cy="82" r="9" />
        </g>
        <Coin cx={172} cy={100} rx={16} />
        <Spark x={172} y={30} r={9} />
      </>
    )}

    {name === 'bell' && (
      <>
        <g className="illo-swing">
          <g transform="rotate(-7 96 70)">
            <Body d="M96 26 a30 30 0 0 1 30 30 v22 l11 15 H55 l11-15 V56 a30 30 0 0 1 30-30 Z" />
            <path className="illo-detail" d="M83 93 a13 13 0 0 0 26 0" />
          </g>
        </g>
        <path className="illo-detail illo-ripple" d="M150 44 q12 -10 0 -20 M161 57 q19 -16 0 -32" />
        <circle className="illo-solid" cx="42" cy="34" r="9" />
        <Spark x={168} y={112} r={9} />
      </>
    )}

    {name === 'search' && (
      <>
        {/* The list behind, the lens over it. */}
        <g transform="rotate(-4 86 70)">
          <Body d="M34 30 H128 a10 10 0 0 1 10 10 V96 a10 10 0 0 1-10 10 H34 a10 10 0 0 1-10-10 V40 a10 10 0 0 1 10-10 Z" />
          <path className="illo-detail" d="M44 52 H104 M44 70 H86 M44 86 H68" />
        </g>
        <g className="illo-scan">
          <g transform="rotate(10 128 62)">
            <Body d="M128 62 m-30 0 a30 30 0 1 0 60 0 a30 30 0 1 0-60 0 Z" />
            <path className="illo-ink" d="M150 84 L172 108" />
          </g>
        </g>
        <Spark x={30} y={118} r={8} />
      </>
    )}

    {name === 'success' && (
      <>
        {/* The tick, and the burst it lands in. */}
        <g transform="rotate(-4 100 74)">
          <Body d="M100 74 m-42 0 a42 42 0 1 0 84 0 a42 42 0 1 0-84 0 Z" />
        </g>
        <path className="illo-ink illo-draw" d="M76 76 L94 96 L128 54" />
        <Spark x={30} y={38} r={10} />
        <Spark x={172} y={104} r={9} />
        <circle className="illo-dot-soft" cx="164" cy="34" r="5" />
        <circle className="illo-dot-soft" cx="36" cy="110" r="4" />
      </>
    )}

    {name === 'error' && (
      <>
        {/* One slip torn in two, and the mark that says so. Nothing here should
            look like a tick - the last version had a stray one. */}
        <Shadow cx={98} cy={122} rx={58} />
        <g className="illo-tear-left" transform="rotate(-11 68 76)">
          <Body d="M28 40 H74 l6 12 -7 11 8 12 -7 11 6 12 H28 a11 11 0 0 1-11-11 V51 a11 11 0 0 1 11-11 Z" />
          <path className="illo-detail" d="M32 62 h28 M32 80 h20" />
        </g>
        <g className="illo-tear-right" transform="rotate(9 138 74)">
          <Body d="M104 40 H160 a11 11 0 0 1 11 11 V87 a11 11 0 0 1-11 11 H104 l6-12 -7-11 8-12 -7-11 Z" />
          <path className="illo-detail" d="M124 62 h30 M124 80 h20" />
        </g>
        <circle className="illo-warn-mass" cx="97" cy="115" r="15" />
        <circle className="illo-warn-dot" cx="94" cy="110" r="15" />
        <path className="illo-warn-cut" d="M94 103 v8" />
        <circle className="illo-warn-cut-dot" cx="94" cy="116" r="2" />
        <Spark x={30} y={26} r={8} />
      </>
    )}

    {name === 'offline' && (
      <>
        <g transform="rotate(-3 100 76)">
          <Body d="M64 96 a24 24 0 0 1 3 -47 a33 33 0 0 1 62 8 a20 20 0 0 1 -4 39 Z" />
        </g>
        <path className="illo-warn illo-strike" d="M44 30 L158 112" />
        <circle className="illo-dot-soft" cx="168" cy="40" r="5" />
        <Spark x={30} y={112} r={8} />
      </>
    )}

    {name === 'welcome' && (
      <>
        {/* The disc arrives, the mark draws itself into it, the scatter settles
            after. A sequence rather than a state - this is the first thing a
            new account sees. */}
        <g className="illo-rise">
          <Body d="M100 68 m-44 0 a44 44 0 1 0 88 0 a44 44 0 1 0-88 0 Z" />
        </g>
        <g transform="translate(54.4 24.5) scale(2.85)">
          <path
            className="illo-mark"
            d={MARK}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        <Spark x={30} y={34} r={10} className="illo-late-1" />
        <Spark x={172} y={106} r={9} className="illo-late-2" />
        <circle className="illo-dot-soft illo-late-2" cx="168" cy="30" r="5" />
        <circle className="illo-dot-soft illo-late-3" cx="32" cy="110" r="4" />
      </>
    )}

    {name === 'add' && (
      <>
        {/* The slip it lands on, and the plus over it. */}
        <g transform="rotate(7 116 92)">
          <Body d="M84 66 H166 a9 9 0 0 1 9 9 v34 a9 9 0 0 1-9 9 H84 a9 9 0 0 1-9-9 V75 a9 9 0 0 1 9-9 Z" />
          <path className="illo-detail" d="M92 86 h34 M92 100 h22" />
        </g>
        <g className="illo-breathe">
          <g transform="rotate(-6 62 52)">
            <Body d="M62 52 m-30 0 a30 30 0 1 0 60 0 a30 30 0 1 0-60 0 Z" />
            <path className="illo-cut-thick" d="M62 38 v28 M48 52 h28" />
          </g>
        </g>
        <Spark x={168} y={28} r={9} />
      </>
    )}

    {name === 'secure' && (
      <>
        <g transform="rotate(-4 96 84)">
          <path className="illo-ink" d="M70 70 V52 a26 26 0 0 1 52 0 v18" />
          <Body d="M56 68 H136 a11 11 0 0 1 11 11 V106 a11 11 0 0 1-11 11 H56 a11 11 0 0 1-11-11 V79 a11 11 0 0 1 11-11 Z" />
          <circle className="illo-solid" cx="96" cy="88" r="9" />
          <path className="illo-cut" d="M96 92 v12" />
        </g>
        <Spark x={172} y={38} r={9} />
        <circle className="illo-dot-soft" cx="28" cy="34" r="5" />
      </>
    )}

    {name === 'ask' && (
      <>
        {/* Your question, and the answer coming back. */}
        <g transform="rotate(4 96 60)">
          <Body d="M46 24 H146 a11 11 0 0 1 11 11 V76 a11 11 0 0 1-11 11 H88 l-22 17 V87 H46 a11 11 0 0 1-11-11 V35 a11 11 0 0 1 11-11 Z" />
          <path className="illo-detail" d="M104 44 h34 M104 62 h24" />
          <path className="illo-solid-shape" d="M72 38 L78 52 L92 57.5 L78 63 L72 77 L66 63 L52 57.5 L66 52 Z" />
        </g>
        <g transform="rotate(-8 158 110)">
          <Body d="M136 96 H176 a9 9 0 0 1 9 9 v10 a9 9 0 0 1-9 9 H136 a9 9 0 0 1-9-9 V105 a9 9 0 0 1 9-9 Z" />
        </g>
        <Spark x={26} y={110} r={8} />
      </>
    )}
  </svg>
);
