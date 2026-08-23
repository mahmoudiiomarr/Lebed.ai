// ===== LEBED.ai SERVICE WORKER =====
// Kept intentionally simple (Tunisian Method): cache the static app shell
// so the app still opens offline / on a bad connection, but ALWAYS prefer
// a fresh copy from the network first when one is reachable — falling
// back to the cache only when the network request fails (offline / bad
// connection). This used to be cache-first, which meant every code update
// to script.js / styles.css kept getting silently ignored by anyone who
// already had the app installed/cached — the browser just kept serving
// the old cached file forever since CACHE_NAME never changed on its own.
// Network-first fixes that going forward with no manual version bump
// needed on every deploy, while still keeping the offline fallback intact.

const CACHE_NAME = 'lebed-ai-v0.4';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './manifest.json',
  './logo pref.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {
        // If a file is missing/renamed, don't block install over it —
        // the app still works fine online, it just won't be offline-cached.
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle simple GETs for the app shell; let everything else
  // (API POSTs to the chat backend, etc.) go straight to the network.
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Got a live copy — use it, and refresh the offline cache with it
        // so the fallback below stays reasonably up to date too.
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
