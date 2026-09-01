import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.moneva.app',
  appName: 'MONEVA',
  webDir: 'dist',
  server: {
    androidScheme: 'http'
  }
};


export default config;
