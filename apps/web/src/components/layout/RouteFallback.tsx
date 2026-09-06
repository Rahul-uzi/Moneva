import React from 'react';
import { ServerWakingNotice } from '../ui/Skeleton';
import './RouteFallback.css';

/**
 * Shown while a lazy route chunk downloads, and while a session is being
 * restored. A skeleton that mirrors the real card rhythm reads as faster than
 * a spinner, because the layout does not visibly jump once content arrives -
 * and using one shape for both stages removes a jump that used to be there.
 *
 * It carries the waking notice because restoring a session against a server
 * that has gone to sleep is exactly when someone is left staring at a loading
 * screen with nothing explaining the wait.
 */
export const RouteFallback: React.FC = () => (
  <div className="route-fallback" role="status" aria-label="Loading">
    <ServerWakingNotice />
    <div className="skeleton skeleton-hero" />
    <div className="skeleton skeleton-line skeleton-line-short" />
    <div className="skeleton skeleton-card" />
    <div className="skeleton skeleton-card" />
  </div>
);
