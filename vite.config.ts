import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// base: './' is required so the built assets load from relative paths
// inside Electron (file://) and the Capacitor Android WebView (https://localhost).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Student application
        main: resolve(__dirname, 'index.html'),
        // Separate admin console (own bundle; only delivered to admin users)
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true, // accept sandbox/proxy preview hosts
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
