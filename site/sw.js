/* The Reading Room — offline shell and cover cache.
 *
 * Scope is deliberately narrow, because getting a service worker wrong on a
 * PWA is worse than not having one:
 *
 *   app shell (index.html, hashed bundle, override layer)
 *       network-first for navigations, cache fallback when offline, so a
 *       changed bundle is never served against a stale index.html.
 *   hashed assets (/assets/*-XXXXXXXX.js|css)
 *       cache-first and kept forever: the hash IS the version.
 *   cover art (/api/cover, /assets/book-art/images/*)
 *       cache-first. Content-addressed by Drive id, so it never changes,
 *       and this is what makes a second visit feel instant.
 *   catalog.json
 *       stale-while-revalidate: show the library immediately, refresh behind.
 *   /api/book/*, /api/library-state
 *       never touched. Book files are streamed with Range requests, which do
 *       not cache correctly, and reading position must never be served stale.
 *
 * Offline BROWSING works after this. Offline READING does not: caching the
 * book files themselves needs a "download" control in the React app, and the
 * app's source is not on the Pi — only the built bundle.
 */
const VERSION = 'rr-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const COVERS = `${VERSION}-covers`;
const DATA = `${VERSION}-data`;
const KEEP = new Set([SHELL, ASSETS, COVERS, DATA]);

const COVER_LIMIT = 3000;   // ~120MB at 40KB a cover

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // Best-effort: a missing file must not abort the install.
    await Promise.allSettled([cache.add(new Request('/', { cache: 'reload' }))]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => (KEEP.has(n) ? null : caches.delete(n))));
    await self.clients.claim();
  })());
});

// An escape hatch: postMessage({type:'rr-sw-reset'}) from the page drops every
// cache and unregisters. Worth having before you need it.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'rr-sw-reset') {
    event.waitUntil((async () => {
      for (const n of await caches.keys()) await caches.delete(n);
      await self.registration.unregister();
    })());
  }
});

const isHashedAsset = (url) =>
  url.pathname.startsWith('/assets/') && /-[A-Za-z0-9_]{8,}\.(js|css)$/.test(url.pathname);

const isCover = (url) =>
  url.pathname === '/api/cover' ||
  (url.pathname.startsWith('/assets/book-art/images/') && /\.(jpe?g|png|webp)$/i.test(url.pathname));

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  // Rough FIFO: oldest insertions come first out of keys().
  await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
}

async function cacheFirst(request, cacheName, opts = {}) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.status === 200) {
    cache.put(request, response.clone());
    if (opts.limit) trim(cacheName, opts.limit);
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return hit || (await network) || Response.error();
}

async function navigationStrategy(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put('/', response.clone());
    return response;
  } catch (err) {
    const cached = (await cache.match(request)) || (await cache.match('/'));
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intervene in book delivery or reading state.
  if (url.pathname.startsWith('/api/book/') ||
      url.pathname.startsWith('/api/library-state') ||
      url.pathname === '/api/health') return;
  // Range requests bypass the cache entirely.
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationStrategy(request));
    return;
  }
  if (isCover(url)) {
    event.respondWith(cacheFirst(request, COVERS, { limit: COVER_LIMIT }));
    return;
  }
  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request, ASSETS));
    return;
  }
  if (url.pathname === '/catalog.json') {
    event.respondWith(staleWhileRevalidate(request, DATA));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(staleWhileRevalidate(request, ASSETS));
  }
});
