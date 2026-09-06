import React from 'react';
import { LottiePlayer } from './LottiePlayer';
import { loadCalendar, loadCoin, loadGrow, loadLock, loadWalk } from './sceneLoaders';
import './TourScenes.css';

export type SceneName =
  | 'grow'
  | 'add'
  | 'payday'
  | 'accounts'
  | 'list'
  | 'search'
  | 'rings'
  | 'goal'
  | 'chat'
  | 'bell'
  | 'lock';

/**
 * Animated scene illustrations for the guided tour - one per step.
 *
 * Four scenes are professionally drawn Lottie animations from LottieFiles'
 * free library (Lottie Simple License; see assets/lottie/CREDITS.md): the
 * ones with people in them, where a hand-drawn figure could not compete. The
 * rest are inline SVG drawn here, flat and bold, animated with transform,
 * opacity and stroke-dashoffset only. Every scene sits on the same dark stage
 * so the two kinds read as one set. All motion stops under
 * prefers-reduced-motion.
 */
export const TourScene: React.FC<{ name: SceneName; accent: string }> = ({ name, accent }) => (
  <div className={`scene-wrap scene-wrap-${name}`} style={{ ['--scene-accent' as string]: accent }}>
    <svg className={`scene scene-${name}`} viewBox="0 0 320 150" role="img" aria-hidden="true">
      {/* Ground: dark navy with a slanted, slightly lighter band, like a stage. */}
      <rect className="scene-bg" width="320" height="150" />
      <polygon className="scene-band" points="0,150 320,96 320,150" />
      <ellipse className="scene-floor" cx="160" cy="132" rx="120" ry="7" />

      {name === 'accounts' && <Accounts />}
      {name === 'list' && <List />}
      {name === 'search' && <Search />}
      {name === 'rings' && <Rings />}
      {name === 'goal' && <Goal />}
      {name === 'chat' && <Chat />}
      {name === 'bell' && <Bell />}
    </svg>

    {/* Lottie scenes are layered over the same stage. */}
    {name === 'grow' && (
      <LottiePlayer className="lottie lottie-grow" load={loadGrow} />
    )}
    {name === 'add' && (
      <>
        {/* The walker arrives from the left edge, then the coin drops into the bank. */}
        <LottiePlayer className="lottie lottie-walk" load={loadWalk} speed={1.15} />
        <LottiePlayer className="lottie lottie-coin" load={loadCoin} speed={1.5} />
        <svg className="plus-hint" viewBox="0 0 40 40" aria-hidden="true">
          <circle className="plus-hint-ring" cx="20" cy="20" r="16" />
          <circle className="plus-hint-face" cx="20" cy="20" r="14" />
          <path d="M20 12 v16 M12 20 h16" className="plus-hint-glyph" />
        </svg>
      </>
    )}
    {name === 'payday' && (
      <LottiePlayer className="lottie lottie-calendar" load={loadCalendar} speed={1.35} />
    )}
    {name === 'lock' && (
      <LottiePlayer className="lottie lottie-lock" load={loadLock} />
    )}
  </div>
);

/* 4. Three account cards fan out of one stack. */
const Accounts = () => (
  <>
    <g className="fan fan-1">
      <rect x="112" y="48" width="96" height="60" rx="10" className="card card-bank" />
      <path d="M128 78 h12 v12 h-12z M144 78 h12 v12 h-12z M160 78 h12 v12 h-12z M124 74 l24 -12 l24 12z" className="card-icon" />
    </g>
    <g className="fan fan-2">
      <rect x="112" y="48" width="96" height="60" rx="10" className="card card-cash" />
      <text x="160" y="88" className="card-rupee">₹</text>
    </g>
    <g className="fan fan-3">
      <rect x="112" y="48" width="96" height="60" rx="10" className="card card-credit" />
      <rect x="124" y="64" width="20" height="14" rx="3" className="card-chip" />
      <rect x="124" y="92" width="60" height="6" rx="3" className="card-line" />
    </g>
  </>
);

/* 5. Receipt rows slide in; the filter pill hops between tabs. */
const List = () => (
  <>
    <g className="tabs">
      <rect x="96" y="28" width="128" height="20" rx="10" className="tabs-track" />
      <rect x="98" y="30" width="40" height="16" rx="8" className="tabs-pill" />
    </g>
    {[0, 1, 2, 3].map((i) => (
      <g key={i} className={`row row-${i + 1}`}>
        <rect x="96" y={58 + i * 18} width="128" height="12" rx="6" className="row-bar" />
        <circle cx="104" cy={64 + i * 18} r="4" className={i % 2 ? 'row-dot in' : 'row-dot out'} />
        <rect x={190 - i * 6} y={60 + i * 18} width={28 + i * 6} height="8" rx="4" className={i % 2 ? 'row-amt in' : 'row-amt out'} />
      </g>
    ))}
  </>
);

/* 6. A magnifier sweeps the list and the hit lights up. */
const Search = () => (
  <>
    {[0, 1, 2, 3].map((i) => (
      <g key={i}>
        <rect x="96" y={40 + i * 20} width="128" height="12" rx="6" className={`row-bar ${i === 2 ? 'row-hit' : ''}`} />
      </g>
    ))}
    <g className="lens">
      <circle cx="0" cy="0" r="18" className="lens-glass" />
      <circle cx="0" cy="0" r="18" className="lens-rim" />
      <path d="M13 13 l16 16" className="lens-handle" />
    </g>
  </>
);

/* 7. Budget rings fill to their level. */
const Rings = () => (
  <>
    {[
      { cx: 96, pct: 0.62, cls: 'ring-a' },
      { cx: 160, pct: 0.35, cls: 'ring-b' },
      { cx: 224, pct: 0.84, cls: 'ring-c' },
    ].map((r) => (
      <g key={r.cls} className={`ring ${r.cls}`} style={{ ['--pct' as string]: r.pct }}>
        <circle cx={r.cx} cy="80" r="26" className="ring-track" />
        <circle cx={r.cx} cy="80" r="26" className="ring-fill" transform={`rotate(-90 ${r.cx} 80)`} />
        <text x={r.cx} y="85" className="ring-label">{Math.round(r.pct * 100)}%</text>
      </g>
    ))}
  </>
);

/* 8. An arrow flies in and lands on the target. */
const Goal = () => (
  <>
    <g className="target">
      <circle cx="210" cy="78" r="40" className="t-1" />
      <circle cx="210" cy="78" r="28" className="t-2" />
      <circle cx="210" cy="78" r="16" className="t-3" />
      <circle cx="210" cy="78" r="5" className="t-4" />
    </g>
    <g className="arrow">
      <path d="M96 78 h96" className="arrow-shaft" />
      <path d="M192 78 l-14 -7 v14z" className="arrow-head" />
      <path d="M96 78 l-12 -8 v16z M108 78 l-12 -8 v16z" className="arrow-fletch" />
    </g>
    <g className="confetti">
      <rect className="cf cf-1" x="230" y="30" width="6" height="6" rx="1" />
      <rect className="cf cf-2" x="250" y="44" width="5" height="5" rx="1" />
      <rect className="cf cf-3" x="238" y="56" width="4" height="4" rx="1" />
    </g>
  </>
);

/* 9. Ask, and the answer types back. */
const Chat = () => (
  <>
    <g className="bubble bubble-user">
      <rect x="120" y="30" width="120" height="30" rx="14" />
      <rect x="132" y="42" width="72" height="6" rx="3" className="bubble-line" />
    </g>
    <g className="bubble bubble-bot">
      <rect x="80" y="74" width="132" height="34" rx="14" />
      <circle cx="112" cy="91" r="4" className="typing typing-1" />
      <circle cx="128" cy="91" r="4" className="typing typing-2" />
      <circle cx="144" cy="91" r="4" className="typing typing-3" />
    </g>
    <g className="spark spark-1"><path d="M232 70 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" /></g>
    <g className="spark spark-2"><path d="M252 96 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" /></g>
  </>
);

/* 10. The bell rings and the badge lands. */
const Bell = () => (
  <>
    <g className="bell">
      <path d="M160 40 a26 26 0 0 1 26 26 v18 l10 12 h-72 l10 -12 v-18 a26 26 0 0 1 26 -26z" className="bell-body" />
      <path d="M150 100 a10 10 0 0 0 20 0" className="bell-clapper" />
      <rect x="156" y="32" width="8" height="10" rx="4" className="bell-body" />
    </g>
    <path d="M118 52 q-16 22 0 44" className="wave wave-1" />
    <path d="M202 52 q16 22 0 44" className="wave wave-2" />
    <path d="M104 44 q-26 30 0 60" className="wave wave-3" />
    <path d="M216 44 q26 30 0 60" className="wave wave-4" />
    <g className="badge">
      <circle cx="190" cy="44" r="12" />
      <text x="190" y="48">3</text>
    </g>
  </>
);
