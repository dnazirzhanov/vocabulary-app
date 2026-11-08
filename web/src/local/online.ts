import { useSyncExternalStore } from 'react';

/**
 * Whether the app is showing what this device kept because the server can't be reached. Set when
 * a screen falls back to its kept copy, cleared when a request gets through or the browser says it
 * is back online.
 */
let offline = typeof navigator !== 'undefined' && navigator.onLine === false;
const listeners = new Set<() => void>();

export function setOffline(value: boolean) {
  if (value === offline) return;
  offline = value;
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => setOffline(true));
  window.addEventListener('online', () => setOffline(false));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useOffline = () => useSyncExternalStore(subscribe, () => offline);
