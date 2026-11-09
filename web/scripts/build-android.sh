#!/bin/sh
# The signed release APK (docs/android.md). Needs APP_URL, VITE_SUPABASE_URL and
# VITE_SUPABASE_PUBLISHABLE_KEY in the environment, and the release key's settings in
# ~/.gradle/gradle.properties. Writes ~/slovar-release/slovar-<version>.apk and its SHA-256.
set -eu
: "${APP_URL:?the https address of the app}"
: "${VITE_SUPABASE_URL:?}"
: "${VITE_SUPABASE_PUBLISHABLE_KEY:?}"
case "$APP_URL" in https://*) ;; *) echo "APP_URL must be https" >&2; exit 1 ;; esac
grep -q '^SLOVAR_RELEASE_STORE_FILE=' "$HOME/.gradle/gradle.properties" 2>/dev/null ||
  { echo "No release key in ~/.gradle/gradle.properties (docs/android.md)" >&2; exit 1; }

cd "$(dirname "$0")/.."
rm -rf dist-app
VITE_PLATFORM=android VITE_API_URL="$APP_URL" VITE_PUBLIC_URL="$APP_URL" VITE_AUTH_MODE=supabase \
  npm run build -- --outDir dist-app
npx cap sync android
(cd android && ./gradlew --quiet clean assembleRelease)

TOOLS="$(ls -d "${ANDROID_HOME:-$HOME/Library/Android/sdk}"/build-tools/*/ | sort -V | tail -1)"
VERSION="$(grep -m1 'versionName' android/app/build.gradle | sed 's/.*"\(.*\)".*/\1/')"
OUT="$HOME/slovar-release/slovar-$VERSION.apk"
mkdir -p "$HOME/slovar-release"
cp android/app/build/outputs/apk/release/app-release.apk "$OUT"
"$TOOLS/apksigner" verify --print-certs "$OUT" | grep -E 'Signer #1 certificate (DN|SHA-256)'
"$TOOLS/aapt2" dump badging "$OUT" | head -1
shasum -a 256 "$OUT" | tee "$OUT.sha256"
