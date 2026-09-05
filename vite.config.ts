import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

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

// FRESH-SEED: `scripts/refresh-seed.mjs` (run by build:web) writes the live
// published catalog to the gitignored .live.admin-catalog.json. This plugin
// makes the bundled seed import resolve to that file when it exists, so the
// offline fallback always ships the latest published branding/curricula
// instead of whatever snapshot happened to be committed last.
const liveSeed = new URL('./src/config/seed/.live.admin-catalog.json', import.meta.url);
const committedSeed = new URL('./src/config/seed/admin-catalog.json', import.meta.url);
const freshSeedPlugin = {
  name: 'cgpa-pilot-fresh-seed',
  enforce: 'pre' as const,
  resolveId(source: string) {
    if (source.endsWith('seed/admin-catalog.json')) return '\0cgpa-pilot-seed';
    return null;
  },
  load(id: string) {
    if (id !== '\0cgpa-pilot-seed') return null;
    const raw = readFileSync(existsSync(liveSeed) ? liveSeed : committedSeed, 'utf8');
    return `export default ${raw};`;
  },
};

export default defineConfig({
  plugins: [freshSeedPlugin, react()],
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
