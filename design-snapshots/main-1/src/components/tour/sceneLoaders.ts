import type { SceneName } from './TourScenes';

/**
 * The animation files behind the Lottie scenes, kept out of the component
 * file so the tour engine can warm them without importing a component module
 * for its side effects. Each loader is its own dynamic import, so Vite keeps
 * every scene in a separate chunk and nothing loads until it is asked for.
 */
export type Loader = () => Promise<{ default: unknown }>;

export const loadGrow: Loader = () => import('../../assets/lottie/grow.json');
export const loadWalk: Loader = () => import('../../assets/lottie/walk.json');
export const loadCoin: Loader = () => import('../../assets/lottie/coin.json');
export const loadCalendar: Loader = () => import('../../assets/lottie/calendar.json');
export const loadLock: Loader = () => import('../../assets/lottie/lock.json');

const SCENE_FILES: Partial<Record<SceneName, Loader[]>> = {
  grow: [loadGrow],
  add: [loadWalk, loadCoin],
  payday: [loadCalendar],
  lock: [loadLock],
};

/**
 * Warms the player and a scene's animation files so the step opens with its
 * picture already parsed instead of a beat after the card. Fire and forget:
 * a failure here just means the scene loads on demand as before.
 */
export function preloadScene(name: SceneName): void {
  const files = SCENE_FILES[name];
  if (!files) return;
  void import('lottie-web/build/player/lottie_light_canvas').catch(() => undefined);
  for (const load of files) void load().catch(() => undefined);
}
