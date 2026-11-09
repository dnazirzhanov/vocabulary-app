# The Android app (ADR 0063)

The web app inside a native shell (Capacitor 8, `web/android/`), given out as a signed APK, not through Google Play.

| Thing | Value |
|---|---|
| Application ID | `kg.slovar.app` |
| Name | «Словарь» |
| Pages served from | `https://localhost` inside the app |
| Permissions | INTERNET only |
| Android versions | 7.0 (API 24) and newer |

**The pages' origin holds each learner's stored data:** IndexedDB with unsent answers, and the sign-in. Never change `androidScheme` in `web/capacitor.config.ts`: an update would start empty and lose what wasn't sent.

## Once, on the build computer
1. **Tools:**
   - JDK 21: `brew install openjdk@21`;
   - the Android SDK (platform 36, build-tools): Android Studio's SDK Manager, or the copy already in `~/Library/Android/sdk`.
2. **The release key.** Make it once and keep it forever:
   ```sh
   mkdir -p ~/slovar-release && cd ~/slovar-release
   keytool -genkeypair -v -keystore slovar-release.jks -alias slovar -keyalg RSA -keysize 4096 -validity 10000 \
     -dname "CN=Slovar, O=Slovar, C=KG"
   ```
   It asks for a password; use a long random one.
3. **Store the key safely, twice:**
   - put the `.jks` file and its password in your password manager;
   - keep a second copy somewhere separate (an encrypted USB stick).

   **If the key is lost, no installed app can ever be updated:** every student would have to delete the app, losing unsent answers, and install a new one.
4. **Tell Gradle where the key is,** in `~/.gradle/gradle.properties`. This file is on this computer only, never in git:
   ```
   SLOVAR_RELEASE_STORE_FILE=/Users/<you>/slovar-release/slovar-release.jks
   SLOVAR_RELEASE_STORE_PASSWORD=…
   SLOVAR_RELEASE_KEY_ALIAS=slovar
   SLOVAR_RELEASE_KEY_PASSWORD=…
   ```
   Then `chmod 600 ~/.gradle/gradle.properties`.

## Each release
1. **Raise the version** in `web/android/app/build.gradle`:
   - `versionCode`: +1 every time; a phone refuses an "update" with the same or a lower number;
   - `versionName`: what people see, e.g. `1.0.1`.
2. **Build:**
   ```sh
   cd web
   export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=~/Library/Android/sdk
   APP_URL=https://<the app's address> \
   VITE_SUPABASE_URL=https://<project>.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key> \
     scripts/build-android.sh
   ```
   It builds the web app for Android (the API and site at `APP_URL`, Supabase sign-in), copies it into the project, builds the signed APK, checks the signature, and prints its SHA-256.
3. **Install it once yourself before sending:** on the emulator (`adb install -r …`) or a phone. Then:
   - open it;
   - sign in;
   - study a card.
4. **Send** `slovar-<versionName>.apk` and its SHA-256 (from step 2). Students install it over the old one, deleting nothing (`docs/pilot-android-ru.md`), and everything they had stays.

## Checking a build
- `apksigner verify --print-certs <apk>`: the certificate must be the same for every release (`CN=Slovar`, and the same SHA-256 digest as the first one).
- `aapt2 dump badging <apk> | head -3`: the package `kg.slovar.app`, and the version you set.

## Testing on the emulator against this computer's API
**A debug build allows plain http to `localhost` only** (`app/src/debug/res/xml/network_security_config.xml`). A release build allows https only.
```sh
cd web
VITE_PLATFORM=android VITE_API_URL=http://localhost:8003 VITE_PUBLIC_URL=http://localhost:8003 npx vite build --outDir dist-app
npx cap sync android && (cd android && ./gradlew assembleDebug)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk && adb reverse tcp:8003 tcp:8003
```
**The API for this test** runs with dev sign-in and `ALLOWED_ORIGINS=https://localhost`.

**Inspecting the app:** a debug build's web view can be inspected through `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` (Chrome DevTools protocol).

## What the app doesn't do (and the website does)
- **Reminders:** an app's web view has no web push.
- **Group invites:** the invite link opens in the phone's browser. Join there with the same e-mail and password, and the group appears in the app.
