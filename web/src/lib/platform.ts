/**
 * Where the app runs. The website serves its own pages and API; the Android app (Capacitor) has its
 * pages inside it and reaches the API and the website by their full addresses.
 */
// Outside Vite (unit tests under Node) there are no build settings: the website's defaults.
const env: Partial<ImportMetaEnv> = import.meta.env ?? {};

export const isApp = env.VITE_PLATFORM === 'android';

/** The API's address: the same site on the web, the production server in the app. */
export const apiBase = `${env.VITE_API_URL ?? ''}/api`;

/** The website, for links to share (invites): this page's own address unless built for the app. */
export const publicUrl = env.VITE_PUBLIC_URL || (typeof location === 'undefined' ? '' : location.origin);
