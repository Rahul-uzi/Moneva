import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.moneva.app',
  appName: 'MONEVA',
  webDir: 'dist',
  server: {
    androidScheme: 'http'
  },
  plugins: {
    // Live updates, self-hosted (see src/services/liveUpdate.ts). The app
    // decides what and when from its own signed manifest, so the plugin's
    // own update checks are off - and so is its default reporting of crashes,
    // errors and usage to capgo.app. Nothing about this app's users goes to a
    // third party.
    CapacitorUpdater: {
      autoUpdate: false,
      statsUrl: '',
      updateUrl: '',
      channelUrl: '',
      appReadyTimeout: 10000,
      autoDeleteFailed: true,
      autoDeletePrevious: true,
      resetWhenUpdate: true,
    },
  },
};


export default config;
