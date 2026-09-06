import React from 'react';
import './RouteFallback.css';

/**
 * Shown while a lazy route chunk downloads. A skeleton that mirrors the real
 * card rhythm reads as faster than a spinner, because the layout does not
 * visibly jump once content arrives.
 */
export const RouteFallback: React.FC = () => (
  <div className="route-fallback" role="status" aria-label="Loading">
    <div className="skeleton skeleton-hero" />
    <div className="skeleton skeleton-line skeleton-line-short" />
    <div className="skeleton skeleton-card" />
    <div className="skeleton skeleton-card" />
  </div>
);
