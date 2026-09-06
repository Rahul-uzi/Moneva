import React from 'react';

/**
 * The MONEVA mark.
 *
 * One unbroken stroke that dips, rises and dips again - a signal, which is what
 * the whole direction is named for. Kept as markup rather than an image asset:
 * it takes `currentColor`, stays crisp at any density, needs no dark-mode
 * filter hack, and adds nothing to the download.
 *
 * Two treatments only. Bare, it is a voltage stroke on the ground. On a tile,
 * it is the dark on-brand ink on a voltage square - the same pairing as the
 * launcher icon, so the app and its icon read as one thing.
 */

const PATH = 'M5 22.5 11 12l5 6.5L21 8l6 14.5';

interface LogoProps {
  className?: string;
  /** Draw the mark on a filled voltage tile rather than as a bare stroke. */
  tile?: boolean;
  /** Explicit pixel size. Omit to let CSS size it. */
  size?: number;
  /** Announced name; pass null for a purely decorative instance. */
  label?: string | null;
}

export const Logo: React.FC<LogoProps> = ({ className, tile = false, size, label = 'MONEVA' }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    role={label ? 'img' : 'presentation'}
    aria-label={label ?? undefined}
    aria-hidden={label ? undefined : true}
  >
    {tile && <rect width="32" height="32" rx="9" fill="var(--moneva-blue)" />}
    <path
      d={PATH}
      stroke={tile ? 'var(--moneva-on-brand)' : 'currentColor'}
      strokeWidth={tile ? 3.6 : 3.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * Mark plus wordmark. The wordmark is the UI face at its heaviest weight with
 * tight tracking - no second typeface, because the system only has one.
 */
export const LogoLockup: React.FC<{ className?: string; size?: number }> = ({
  className,
  size = 34,
}) => (
  <span
    className={className}
    style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.3 }}
  >
    <Logo tile size={size} label={null} />
    <span
      style={{
        fontSize: size * 0.62,
        fontWeight: 800,
        letterSpacing: '-0.055em',
        color: 'var(--moneva-text-main)',
      }}
    >
      MONEVA
    </span>
  </span>
);
