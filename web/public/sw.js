// The app's service worker (ADR 0042, 0060): it shows pushed notifications, and keeps the app
// itself on the device so it opens without a connection. The build fills in SHELL and VERSION
// (vite.config.ts, `serviceWorker`); in development they stay empty and the worker isn't used.
const VERSION = 'dev';
const SHELL = [];

const SHELL_CACHE = `shell-${VERSION}`;
// A kept file is the same file whatever the request said: some servers add `Vary: Origin`, which
// would otherwise keep a navigation from matching the page kept at install.
const AUDIO_CACHE = 'audio-1';
const READING_CACHE = 'reading-1';

self.addEventListener('install', (event) => {
  // The whole app, or nothing: a half-saved shell would open broken offline.
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // Older versions of the app go; recorded audio stays.
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((name) => name.startsWith('shell-') && name !== SHELL_CACHE).map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Only the app's own files. The API is never answered from here: its data is the app's to keep
  // (IndexedDB, per account), never a shared cache.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // The newest app when online; without a connection, the one kept at install.
    event.respondWith(fetch(request).catch(() => caches.match('/', { cacheName: SHELL_CACHE, ignoreVary: true })));
    return;
  }
  if (url.pathname.startsWith('/reading/')) {
    // Reading Mode's articles: the newest when online, kept to read again offline. An article
    // changes only with a new build, so a stale copy is never worse than none.
    event.respondWith(
      caches.open(READING_CACHE).then((cache) =>
        fetch(request)
          .then((response) => {
            if (response.ok) void cache.put(request, response.clone());
            return response;
          })
          .catch(() => cache.match(request, { ignoreVary: true }).then((kept) => kept ?? Response.error())),
      ),
    );
    return;
  }
  if (url.pathname.startsWith('/audio/')) {
    // Recorded pronunciation: kept once heard, so it plays again offline.
    event.respondWith(
      caches.open(AUDIO_CACHE).then((cache) =>
        cache.match(request, { ignoreVary: true }).then(
          (kept) =>
            kept ??
            fetch(request).then((response) => {
              if (response.ok) void cache.put(request, response.clone());
              return response;
            }),
        ),
      ),
    );
    return;
  }
  // Built files never change under their name: the kept copy, else the network.
  event.respondWith(
    caches.match(request, { cacheName: SHELL_CACHE, ignoreVary: true }).then((kept) => kept ?? fetch(request)),
  );
});

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
