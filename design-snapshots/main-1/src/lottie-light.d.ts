// The light player build ships without its own declaration file; it exposes
// the same API as the main entry.
declare module 'lottie-web/build/player/lottie_light' {
  import type { LottiePlayer } from 'lottie-web';
  const lottie: LottiePlayer;
  export default lottie;
}

declare module 'lottie-web/build/player/lottie_light_canvas' {
  import type { LottiePlayer } from 'lottie-web';
  const lottie: LottiePlayer;
  export default lottie;
}
