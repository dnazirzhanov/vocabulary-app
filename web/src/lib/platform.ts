/**
 * Where the app runs. The website serves its own pages and API; the Android app (Capacitor) has its
 * pages inside it and reaches the API and the website by their full addresses.
 */
export const isApp = import.meta.env.VITE_PLATFORM === 'android';

/** The API's address: the same site on the web, the production server in the app. */
export const apiBase = `${import.meta.env.VITE_API_URL ?? ''}/api`;

/** The website, for links to share (invites): this page's own address unless built for the app. */
export const publicUrl = import.meta.env.VITE_PUBLIC_URL || location.origin;
