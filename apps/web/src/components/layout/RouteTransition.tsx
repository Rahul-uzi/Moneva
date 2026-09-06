import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Tab order as it reads in the dock. Direction comes from this, not from
 * history, so moving right along the bar always slides in from the right and
 * moving left always slides in from the left - the movement matches the thing
 * you tapped.
 */
const TAB_ORDER = ['/', '/activity', '/accounts', '/plan', '/analytics', '/assistant', '/profile'];

type Direction = 'fwd' | 'back';

const directionBetween = (from: string, to: string): Direction => {
  const a = TAB_ORDER.indexOf(from);
  const b = TAB_ORDER.indexOf(to);
  // An unknown route on either side has no place in the order, so it arrives
  // forwards rather than guessing.
  return a !== -1 && b !== -1 && b < a ? 'back' : 'fwd';
};

/**
 * Screen-to-screen transition.
 *
 * The previous path is held in state and adjusted during render - React's own
 * pattern for deriving from a changed prop - rather than in a ref, so the
 * direction is settled before the new screen ever paints. A ref would be read
 * during render, and an effect would land one frame too late.
 *
 * The animation uses `backwards` fill on purpose. `both` would leave
 * `transform: none` applied forever, and any transform makes the element the
 * containing block for its position:fixed descendants - which would push every
 * modal opened from a page off screen.
 */
export const RouteTransition: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pathname } = useLocation();
  const [previous, setPrevious] = useState<string>(pathname);
  const [direction, setDirection] = useState<Direction>('fwd');

  if (previous !== pathname) {
    setDirection(directionBetween(previous, pathname));
    setPrevious(pathname);
  }

  return (
    <div key={pathname} className="route-swap" data-dir={direction}>
      {children}
    </div>
  );
};
