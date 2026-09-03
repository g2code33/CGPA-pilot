// CGPA Pilot service worker — offline app shell for web/PWA.
//
// Caching strategy:
//   • The navigation document / app shell (`./`, `index.html`, `admin.html`) is
//     served NETWORK-FIRST: we always try the server so a freshly deployed
//     build shows on the next app open, and only fall back to the cache when
//     offline. This is what keeps users from being stuck on an old version.
//   • Static assets (JS/CSS/images) are content-hashed by Vite, so they can be
//     served CACHE-FIRST safely — a new file name simply isn't in the cache yet
//     and gets fetched once.
//
// Bump `CACHE` whenever you change this file's caching rules; old caches are
// deleted on activate so devices pick up the new rules immediately.
const CACHE = 'cgpa-pilot-v3';

const SHELL = [
  './',
  './index.html',
  './admin.html',
  './manifest.webmanifest',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Navigation / page requests → NETWORK-FIRST (fresh build when online).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() =>
          caches.match(request).then(
            (cached) => cached || caches.match('./index.html')
          )
        )
    );
    return;
  }

  // Everything else (hashed assets) → CACHE-FIRST, falling back to the network.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((res) => {
          // Cache same-origin static assets on first load.
          if (res.ok && new URL(request.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
