/** What a reminder needs to know about this device (ADR 0031); no app imports, so testable. */

export function isAppleMobile(agent = navigator.userAgent, touchPoints = navigator.maxTouchPoints): boolean {
  // iPadOS reports itself as a Mac; its touch screen gives it away.
  return /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && touchPoints > 1);
}

/** The server's key (base64url) as the bytes `pushManager.subscribe` takes. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}
