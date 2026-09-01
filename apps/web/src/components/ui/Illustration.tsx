import React from 'react';
import './Illustration.css';

export type IllustrationName = 'empty' | 'error' | 'offline' | 'success';

interface Props {
  name: IllustrationName;
  size?: number;
}

/**
 * Inline SVG spot illustrations. Kept as markup rather than image assets so
 * they add no download weight, inherit the MONEVA palette through CSS
 * variables, and stay crisp at any density.
 */
export const Illustration: React.FC<Props> = ({ name, size = 132 }) => (
  <svg
    className={`moneva-illustration illo-${name}`}
    width={size}
    height={size * 0.78}
    viewBox="0 0 170 132"
    fill="none"
    role="presentation"
    aria-hidden="true"
  >
    {/* Shared ground shadow keeps the set feeling like one family. */}
    <ellipse className="illo-ground" cx="85" cy="118" rx="52" ry="7" />

    {name === 'empty' && (
      <>
        <rect className="illo-surface" x="42" y="46" width="86" height="60" rx="10" />
        <path className="illo-lid" d="M38 46 L85 22 L132 46 Z" />
        <rect className="illo-line" x="58" y="66" width="54" height="6" rx="3" />
        <rect className="illo-line illo-line-dim" x="58" y="80" width="34" height="6" rx="3" />
        <circle className="illo-accent" cx="127" cy="34" r="9" />
        <circle className="illo-accent illo-accent-2" cx="45" cy="28" r="5" />
      </>
    )}

    {name === 'error' && (
      <>
        <rect className="illo-surface" x="42" y="40" width="86" height="66" rx="10" />
        <path className="illo-stroke" d="M70 62 L100 88 M100 62 L70 88" strokeLinecap="round" />
        <circle className="illo-danger" cx="128" cy="36" r="11" />
        <path className="illo-danger-mark" d="M128 31 v6" strokeLinecap="round" />
        <circle className="illo-danger-mark-dot" cx="128" cy="41" r="1.4" />
      </>
    )}

    {name === 'offline' && (
      <>
        <rect className="illo-surface" x="52" y="44" width="66" height="62" rx="10" />
        <path className="illo-stroke" d="M62 74 q23 -22 46 0" strokeLinecap="round" />
        <path className="illo-stroke illo-line-dim" d="M74 86 q11 -11 22 0" strokeLinecap="round" />
        <circle className="illo-accent" cx="85" cy="96" r="3.5" />
        <path className="illo-slash" d="M44 30 L126 112" strokeLinecap="round" />
      </>
    )}

    {name === 'success' && (
      <>
        <circle className="illo-success-ring" cx="85" cy="66" r="34" />
        <path className="illo-success-check" d="M70 67 l11 11 l20 -23" strokeLinecap="round" strokeLinejoin="round" />
        <circle className="illo-accent" cx="129" cy="34" r="6" />
        <circle className="illo-accent illo-accent-2" cx="42" cy="44" r="4" />
      </>
    )}
  </svg>
);
