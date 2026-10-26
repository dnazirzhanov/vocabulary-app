/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "supabase" in production builds; anything else means local development users. */
  readonly VITE_AUTH_MODE?: string;
  readonly VITE_SUPABASE_URL?: string;
  /** The project's publishable (anon) key: public by design, safe in the browser. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
