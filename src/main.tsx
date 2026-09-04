import React from 'react';
import ReactDOM from 'react-dom/client';
import { StoreProvider } from './state/store';
import { InstitutionProvider } from './state/institutionSelection';
import App from './App';
import {
  bootStudentConfig,
  startBackgroundConfigSync,
} from './services/configSync';
import './index.css';

// ─────────────────────────────────────────────────────────────────────────
// OFFLINE-FIRST BOOT:
//   1. Load the locally cached published configuration (IndexedDB → bundled
//      seed) and set it as the runtime catalog — the app ALWAYS renders from
//      local data first, so it works with no network at all.
//   2. When online, make a bounded check against the config backend: if a
//      NEWER published configuration exists it is downloaded, validated and
//      applied BEFORE first paint (fast networks) — otherwise the app runs
//      the local copy and a background pass finishes any interrupted update.
//   3. Render. Student academic data is never involved in any of this.
// ─────────────────────────────────────────────────────────────────────────
async function main() {
  // Register the PWA service worker (production builds / http(s) only).
  // It caches the app shell so the web/PWA version works fully offline.
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        /* offline SW is best-effort; app still runs without it */
      });
    });

    // When a freshly-downloaded service worker takes control (it calls
    // skipWaiting, so it never lingers in the "waiting" state), reload once
    // so the newly deployed build actually appears instead of leaving the
    // user on the previous version indefinitely.
    let refreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshed) return;
      refreshed = true;
      window.location.reload();
    });
  }

  const outcome = await bootStudentConfig().catch(() => null);
  // Defensive: boot must never block the app — on any unexpected failure the
  // runtime catalog still holds a valid (cached/seed) configuration.
  console.info('[config]', outcome ? `boot sync: ${outcome.status}` : 'boot sync skipped (local config only)');

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <StoreProvider>
        <InstitutionProvider>
          <App />
        </InstitutionProvider>
      </StoreProvider>
    </React.StrictMode>
  );

  // Deferred re-check after load + on "online": keeps the local store current
  // and offers an explicit "reload to apply" when a new version arrives
  // mid-session (never an automatic reload while the student is working).
  startBackgroundConfigSync();
}

void main();
