import React, { useEffect, useState } from 'react';
import './Arc.css';

interface ArcProps {
  /** Progress, 0 to 1. Values outside are clamped. */
  value: number;
  size?: number;
  stroke?: number;
  /** What the arc means, for anyone not looking at it. */
  label: string;
  /** Ember instead of voltage, for a budget that has gone over. */
  tone?: 'accent' | 'warn';
  className?: string;
  /** The figure that sits in the middle. */
  children?: React.ReactNode;
}

/**
 * One value against its target, drawn as a single arc on its track.
 *
 * Deliberately not a donut: there are no slices to compare, so it owes no
 * legend and needs no colour system behind it. Category breakdowns belong in
 * labelled bars, where the numbers can actually be read.
 *
 * The drawn length has a floor of one stroke width, so a month that has barely
 * started still reads as an arc that was drawn rather than a ring that failed
 * to render.
 */
export const Arc: React.FC<ArcProps> = ({
  value,
  size = 186,
  stroke = 14,
  label,
  tone = 'accent',
  className,
  children,
}) => {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const on = Math.max(circumference * clamped, stroke);
  const percent = Math.round(clamped * 100);

  return (
    <div className={['moneva-arc', className].filter(Boolean).join(' ')} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${percent}%`}>
        <circle className="arc-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className={`arc-fill arc-${tone}`}
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${on} ${circumference - on}`}
          strokeDashoffset={drawn ? 0 : on}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children !== undefined && <div className="arc-middle">{children}</div>}
    </div>
  );
};
