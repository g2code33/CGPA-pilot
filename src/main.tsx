import React from 'react';
import ReactDOM from 'react-dom/client';
import { StoreProvider } from './state/store';
import { InstitutionProvider } from './state/institutionSelection';
import { ErrorBoundary } from './ErrorBoundary';
import App from './App';
import {
  bootStudentConfig,
  onConfigUpdate,
  startBackgroundConfigSync,
} from './services/configSync';
import { isStudentDataPresent } from './state/studentState';
import { applyBrandFavicon } from './config/branding';
import { getRuntimeCatalog } from './config/runtime';
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
  // Keep pinch-zoom out of the PWA/website (pairs with
  // maximum-scale=1, user-scalable=no in index.html — the standard
  // best-effort combo; a few browsers keep an accessibility zoom).
  document.addEventListener('gesturestart', (e) => e.preventDefault());

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

  // Log anything the ErrorBoundary can't catch (event handlers, async
  // callbacks) so failures are diagnosable instead of silent.
  window.addEventListener('error', (e) =>
    console.error('[crash] uncaught error:', e.message, e.error ?? '')
  );
  window.addEventListener('unhandledrejection', (e) =>
    console.error('[crash] unhandled rejection:', e.reason)
  );

  const outcome = await bootStudentConfig().catch(() => null);
  // Defensive: boot must never block the app — on any unexpected failure the
  // runtime catalog still holds a valid (cached/seed) configuration.
  console.info('[config]', outcome ? `boot sync: ${outcome.status}` : 'boot sync skipped (local config only)');

  // Browser tab icon = the admin-set app logo (keeps the bundled icon when
  // the admin has not set one). PWA/desktop icon: served dynamically by the
  // Worker (manifest + /app-icon) and refreshed on the next app launch.
  applyBrandFavicon(getRuntimeCatalog().appearance);

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <StoreProvider>
          <InstitutionProvider>
            <App />
          </InstitutionProvider>
        </StoreProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );

  // Deferred re-check after load + on "online": keeps the local store current
  // and offers an explicit "reload to apply" when a new version arrives
  // mid-session (never an automatic reload while the student is working).
  startBackgroundConfigSync();

  // When a newer published config LANDS while this session holds NO student
  // data — fresh open, boot that timed out mid-download, or right after a
  // Clear — apply it with an immediate reload: nothing has been entered, so
  // nothing can be lost, and the user sees the current branding without any
  // manual refreshing. Sessions with entered data keep the explicit
  // "reload to apply" banner (never an automatic reload while working).
  onConfigUpdate((p) => {
    if (p && !isStudentDataPresent()) window.location.reload();
  });
}

void main();
