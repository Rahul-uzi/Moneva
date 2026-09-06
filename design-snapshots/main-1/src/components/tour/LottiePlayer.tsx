import React, { useEffect, useRef } from 'react';
import type { AnimationItem } from 'lottie-web';

/**
 * Renders a bundled Lottie animation with the light player.
 *
 * The animation JSON and the player itself are both loaded on demand - the
 * tour is the only thing that uses them, and a first-time user should not pay
 * ~170 KB of player plus the scene files on every launch for a tour they see
 * once. `load` returns the module for one JSON file, so Vite keeps each scene
 * in its own chunk.
 *
 * Drawn with the canvas renderer, not SVG. The scenes have up to 161 shape
 * layers, and with the SVG renderer each one is a DOM node the main thread
 * restyles every frame - which on a mid-range phone cost about a third of the
 * frame budget and made the whole tour feel heavy. Canvas draws the same
 * picture in one pass.
 *
 * Under prefers-reduced-motion the animation is parked on its final frame:
 * the picture is still there, it just does not move.
 */
export interface LottiePlayerProps {
  load: () => Promise<{ default: unknown }>;
  loop?: boolean;
  speed?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Called once the animation has been parsed and drawn. */
  onReady?: () => void;
}

export const LottiePlayer: React.FC<LottiePlayerProps> = ({
  load,
  loop = true,
  speed = 1,
  className,
  style,
  onReady,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let anim: AnimationItem | null = null;
    let cancelled = false;

    void (async () => {
      const [{ default: lottie }, data] = await Promise.all([
        import('lottie-web/build/player/lottie_light_canvas'),
        load(),
      ]);
      if (cancelled || !hostRef.current) return;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      anim = lottie.loadAnimation({
        container: hostRef.current,
        renderer: 'canvas',
        loop: reduce ? false : loop,
        autoplay: !reduce,
        animationData: data.default as object,
        rendererSettings: {
          preserveAspectRatio: 'xMidYMid meet',
          // The scenes are ~150px tall on screen; a 3x backing store is three
          // times the pixels to draw for a difference nobody can see.
          dpr: Math.min(window.devicePixelRatio || 1, 2),
          clearCanvas: true,
        },
      });
      anim.setSpeed(speed);
      anim.addEventListener('DOMLoaded', () => {
        if (reduce && anim) anim.goToAndStop(Math.max(0, anim.totalFrames - 1), true);
        onReady?.();
      });
    })();

    return () => {
      cancelled = true;
      anim?.destroy();
      anim = null;
    };
    // The loader identity is stable per scene; re-running on every render
    // would tear the animation down and rebuild it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className={className} style={style} aria-hidden="true" />;
};
