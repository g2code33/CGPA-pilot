import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' is required so the built assets load from relative paths
// inside Electron (file://) and the Capacitor Android WebView (https://localhost).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
