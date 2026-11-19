import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tone01.tuner',
  appName: 'TONE.01',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#0A0A0A',
    allowMixedContent: false,
  },
};

export default config;
