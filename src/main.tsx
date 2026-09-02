import React from 'react';
import ReactDOM from 'react-dom/client';
import { StoreProvider } from './state/store';
import { InstitutionProvider } from './state/institutionSelection';
import App from './App';
import './index.css';

// Register the PWA service worker (production builds / http(s) only).
// It caches the app shell so the web/PWA version works fully offline.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline SW is best-effort; app still runs without it */
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StoreProvider>
      <InstitutionProvider>
        <App />
      </InstitutionProvider>
    </StoreProvider>
  </React.StrictMode>
);
