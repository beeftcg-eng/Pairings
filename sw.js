// Service worker for Pairings — handles real push notifications.
// Must be served from the site's root (e.g. https://yoursite.com/sw.js)
// so its scope covers the whole app.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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
    tag: data.tag || 'pairings-notification',
    icon: undefined,
    badge: undefined,
    data: { url: '/' },
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Pairings', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
