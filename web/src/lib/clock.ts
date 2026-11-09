/**
 * The server's idea of "now". Device clocks on phones are often wrong, so day counts such as
 * "tomorrow" are taken from the time the API reports (X-Server-Time), in the device's time zone.
 */
const KEY = 'server-clock-offset';

/**
 * Kept across visits: answers given without a connection are dated by the server's clock (ADR
 * 0062), as last measured, not by a phone's that may be wrong.
 */
let offsetMs = (() => {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
})();

export function syncWithServer(serverTime: string | null): void {
  const parsed = serverTime ? Date.parse(serverTime) : Number.NaN;
  if (Number.isNaN(parsed)) return;
  offsetMs = parsed - Date.now();
  try {
    localStorage.setItem(KEY, String(offsetMs));
  } catch {
    // private mode: measured again at the next request
  }
}

export const serverNow = (): Date => new Date(Date.now() + offsetMs);
