// Service worker for Pairings — real push notifications plus an offline app shell.
// Must be served from the site's root (e.g. https://yoursite.com/sw.js)
// so its scope covers the whole app.

// Bump this when the list of cached files changes; old caches are deleted
// on activate. (Page/script updates don't need a bump — see the fetch
// handler: online loads always try the network first.)
const CACHE = 'pairings-shell-v1';
const SHELL = ['/', '/config.js', '/manifest.json', '/icon-192.png', '/icon-512.png', '/favicon-32.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  // allSettled: one missing file must not make the whole install fail.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first with a timeout, falling back to the cache. Online users
// always get the newest files (no stale-app problem after a deploy); offline
// or on a very slow venue connection, the last good copy loads instead.
// Only same-origin GETs are handled — Supabase, fonts and CDN requests go
// straight to the network untouched, so API data is never cached here.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;

  const isNav = req.mode === 'navigate';
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Every page navigation (including /?share=CODE and /?storepage=CODE)
    // is stored under '/' — it's the same single-page app.
    const cacheKey = isNav ? '/' : req;
    try {
      const res = await Promise.race([
        fetch(req),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
      ]);
      if (res && res.ok) cache.put(cacheKey, res.clone());
      return res;
    } catch (e) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      throw e;
    }
  })());
});

self.addEventListener('push', (event) => {
  let data = { title: 'Pairings', body: 'You have a new notification.' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body,
    tag: data.tag || `pairings-${Date.now()}`,
    renotify: !!data.tag,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Pairings', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Only same-origin paths — a push payload must never be able to send the
  // user to an arbitrary external site.
  let target = '/';
  let openName = '';
  try {
    const u = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
    if (u.origin === self.location.origin) {
      target = u.pathname + u.search + u.hash;
      openName = u.searchParams.get('open') || '';   // e.g. /?open=notifications
    }
  } catch (e) {}
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          // The app is already open: tell it which screen to show (it only honours
          // names it knows), then bring it to the front.
          if (openName) client.postMessage({ type: 'open', name: openName });
          return client.focus();
        }
      }
      // App closed: start it at the deep link; the page reads ?open= on boot.
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
