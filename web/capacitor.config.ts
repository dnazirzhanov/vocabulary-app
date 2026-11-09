import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android app (ADR 0063): the built web app inside a native shell. Its pages come from
 * https://localhost inside the app; that origin holds the learner's stored data (IndexedDB, the
 * sign-in), so `androidScheme` must never change, or an update would start with nothing.
 */
const config: CapacitorConfig = {
  appId: 'kg.slovar.app',
  appName: 'Словарь',
  webDir: 'dist-app',
  server: { androidScheme: 'https' },
};

export default config;
