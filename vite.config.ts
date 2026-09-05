import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// The app version is injected as import.meta.env.VITE_APP_VERSION so the UI
// can show it (and the update checks can compare local vs. latest).
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string };

// base: './' is required so the built assets load from relative paths
// inside Electron (file://) and the Capacitor Android WebView (https://localhost).
//
// Local API development:
//   1. npx wrangler dev            (Worker + D1 on http://127.0.0.1:8787)
//   2. CF_API_TARGET=http://127.0.0.1:8787 npm run dev
// → the Vite dev server proxies /api/* to the Worker, so the admin console's
//   Save & Publish and the student sync work exactly as in production.
const cfApiTarget = process.env.CF_API_TARGET;

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
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
    proxy: cfApiTarget
      ? { '/api': { target: cfApiTarget, changeOrigin: true } }
      : undefined,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: cfApiTarget
      ? { '/api': { target: cfApiTarget, changeOrigin: true } }
      : undefined,
  },
});
