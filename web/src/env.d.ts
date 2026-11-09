/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "supabase" in production builds; anything else means local development users. */
  readonly VITE_AUTH_MODE?: string;
  readonly VITE_SUPABASE_URL?: string;
  /** The project's publishable (anon) key: public by design, safe in the browser. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /**
   * The Android app (Capacitor): its pages come from inside the app, so the API and the site are
   * named in full. Empty on the website, which serves both itself.
   */
  readonly VITE_API_URL?: string;
  /** The website's address, for links shared with others (group invites). */
  readonly VITE_PUBLIC_URL?: string;
  /** "android" in the app's build. */
  readonly VITE_PLATFORM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
