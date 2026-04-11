/**
 * TeleprΩmpter Service Worker
 * Enables offline use of teleprompter.kre8r.app
 *
 * Strategy:
 *   teleprompter.html       → cache-first (updates silently in background)
 *   /api/teleprompter/*     → network-first, cache fallback
 *   everything else         → network-only (CDN fonts/QR lib — graceful degradation)
 */

'use strict';

const CACHE = 'tp-v1';

// Assets to cache on install
const PRECACHE = [
  '/teleprompter.html',
];

// ── Install: precache the page ──────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting(); // activate immediately, don't wait for old SW to die
});

// ── Activate: purge old cache versions ─────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim(); // take control of all open pages immediately
});

// ── Fetch ───────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // ── teleprompter.html: cache-first, revalidate in background ──
  if (url.pathname === '/teleprompter.html' || url.pathname === '/') {
    event.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match('/teleprompter.html');
        // Always fetch fresh version in background (updates cache silently)
        const networkPromise = fetch(request).then(res => {
          if (res.ok) cache.put('/teleprompter.html', res.clone());
          return res;
        }).catch(() => null);
        // Return cached immediately if available, otherwise wait for network
        return cached || networkPromise;
      })
    );
    return;
  }

  // ── API calls: network-first, cache fallback ──────────────────
  if (url.pathname.startsWith('/api/teleprompter/')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // ── WebSocket upgrade + everything else: pass through ─────────
  // (WS connections not intercepted by SW — browser handles them natively)
});
