# 0060 — The app keeps itself and its screens on the device, one store per account

**Status:** Accepted (7 November 2026). The first step of offline use; personal decks and settings follow (ADR 0061).

## Context
Without a connection the app didn't even open: the service worker only showed notifications, and every screen asked the server. Students on patchy phone connections lose the app altogether.

## Decision
- **The service worker keeps the app** for every visitor of a built app (not in development). A build step writes the list of files into `sw.js`:
  - the page, its code, styles, fonts, the six languages, icons and manifests, about 1 MB;
  - and a version from their contents.

  Install keeps all of them or none. Opening the app tries the network first, so a new version shows at once, and falls back to the kept copy offline. Built files come from the kept copy. Recorded audio is kept once heard. A new version drops the old files. Photo reading (about 10 MB) isn't kept.
- **The API is never answered by the service worker.** Data kept for offline use lives in IndexedDB (`idb`, about 1 KB), and only for screens chosen to work offline: the profile, the course levels and «Мои колоды».
- **One database per account**, named by the account's id (now in `/api/me`). A small `slovar-meta` remembers which account a sign-in is, so the right one opens without a connection; another account's data is never opened.
  - Signing out closes it and keeps it, so nothing unsent is lost.
  - Deleting the account deletes it.
  - No password or token is ever kept there; the sign-in session stays with Supabase's client.
- **Saying so:** while the app shows kept data, one quiet line above the tabs says «Нет соединения. Показано то, что сохранено на этом устройстве.» A request that gets through removes it.
- **Keeping it:** the app asks the browser to keep the data (`navigator.storage.persist()`). Where IndexedDB is refused (private browsing), the app works online only, as before.

## Consequences
- The first visit must be online; after it, the app opens offline and shows what it last saw.
- Changing anything still needs a connection until ADR 0061's outbox.
- Browsers may still evict a site's data under storage pressure, iOS Safari most of all; an installed home-screen app is the safest.
- Every e2e test in CI runs on a production build with the worker active; `e2e/offline.spec.ts` checks the offline start, and that the kept data holds no tokens.
