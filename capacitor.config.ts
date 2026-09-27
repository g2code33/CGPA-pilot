import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cgpapilot.app',
  appName: 'CGPA Pilot',
  webDir: 'dist',
  android: {
    /**
     * The window colour before the first frame paints. Matching `body` in
     * src/index.css is what removes the white flash a student sees when the app
     * opens; the native splash image behind it is generated from the same brand
     * values by scripts/mobile-icons.mjs.
     *
     * Read from the config by name — `CapConfig.deserializeConfig` looks up
     * `android.backgroundColor` (falling back to the legacy top-level key) — so it
     * must stay in this block to have any effect.
     */
    backgroundColor: '#EEF2F7',
  },
};

export default config;
