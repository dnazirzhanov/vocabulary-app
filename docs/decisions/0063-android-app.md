# 0063 — The Android app: the web app in Capacitor, a signed APK given out directly

**Status:** Accepted (the owner's decisions, 9 November 2026).

## Context
The first pilot is 5–10 students on Android phones, as soon as reasonably possible, without waiting for Google Play. The owner sends the app file over Telegram. The web app already works offline (ADR 0060–0062).

## Decision
- **Capacitor 8 around the existing web app** (`web/android/`, Capacitor 8.5.3, pinned).
  - No rewrite, no new screens.
  - Application ID `kg.slovar.app`, name «Словарь» (owner).
  - Android 7 (API 24) and newer; target and compile SDK 36.
- **The pages come from inside the app** (`https://localhost`); the API and the website are named in full (`VITE_API_URL`, `VITE_PUBLIC_URL`, `web/src/lib/platform.ts`).
  - **This origin holds the learner's data** (IndexedDB, the sign-in), so `androidScheme` is fixed for good: an update keeps everything.
  - The recordings and the photo reader ship inside the APK (about 30 MB).
- **No service worker and no web push** in the app: its files are already on the phone, and its web view has no push. Reminders remain the website's.
- **CORS** names the app's origin (`ALLOWED_ORIGINS=https://localhost`). It allows every method and header the app sends (PUT, `X-Time-Zone`, `If-None-Match`), and refuses other origins (tested).
- **Permissions:** INTERNET only.
- **Release builds:** https only. A debug build may use plain http to `localhost`, for testing against the API on the build computer.
- **No Android backup of the app's data** (`allowBackup=false`, data extraction rules exclude everything). The server holds the data. A copy restored onto a new phone would carry the old phone's device id and sign-in, and two phones sharing one device id would confuse the server's check of each device's answers (ADR 0062).
- **Signing:**
  - one release key, made once, kept outside git: the owner's password manager, plus a second copy;
  - Gradle reads it from `~/.gradle/gradle.properties`;
  - every release raises `versionCode`.

  Steps: `docs/android.md`.
- **Joining a group** goes through the invite link in the phone's browser, with the same account. No deep links into the app for the pilot.

## Verified on the emulator (Android 16, WebView 133), before #80 was merged
- **Persistence:** a lesson started online and continued with the server unreachable survived a forced stop and an offline relaunch. Its answers, outbox, study pack, device id and clock offset were all still there.
- **Server matches device:** finished offline and reconnected, the server's due date for every word equalled the device's own.
- **Layout:** the status bar and the gesture bar cover nothing.

## Consequences
- **No automatic updates:** a new APK is sent the same way and installed over the old one.
- **The key is a single point of failure:** losing it means students can't update without reinstalling, and they would lose unsent answers.
- **Google Play Protect** may warn about an app from outside the store. The instructions say what to tap.
