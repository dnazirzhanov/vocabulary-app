// The app's service worker: deadline reminders only (ADR 0031). It caches nothing, so the app
// always loads fresh; it just shows a pushed notification and opens the app when it is tapped.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message = { title: 'Словарь', body: 'Пора повторить слова.', url: '/' };
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
      lang: 'ru',
      // One reminder at a time: a new one replaces yesterday's if it is still there.
      tag: 'deadline',
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
