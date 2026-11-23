import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.homeforge.app',
  appName: 'HomeForge 3D',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
};

export default config;
