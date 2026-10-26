/**
 * The server's idea of "now". Device clocks on phones are often wrong, so day counts such as
 * "tomorrow" are taken from the time the API reports (X-Server-Time), in the device's time zone.
 */
let offsetMs = 0;

export function syncWithServer(serverTime: string | null): void {
  const parsed = serverTime ? Date.parse(serverTime) : Number.NaN;
  if (!Number.isNaN(parsed)) offsetMs = parsed - Date.now();
}

export const serverNow = (): Date => new Date(Date.now() + offsetMs);
