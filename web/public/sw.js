// The app's service worker: notifications only (ADR 0031, 0042). It caches nothing, so the app
// always loads fresh; it just shows a pushed notification and opens the app when it is tapped.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  // The server sends the words, in the learner's language; this only guards against a bad payload.
  let message = { title: 'Slovar', body: '', url: '/', lang: 'ru' };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    // Not JSON: keep the plain message.
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      lang: message.lang,
      // One at a time: a new one replaces the last if it is still there.
      tag: 'reminder',
      data: { url: message.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(self.location.origin));
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
