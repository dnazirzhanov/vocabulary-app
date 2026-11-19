/**
 * Only one sound at a time: the original, a fresh recording and old attempts must never play over
 * each other. Each player claims playback when it starts; the one playing before is paused.
 */
let current: HTMLMediaElement | null = null;

export function claimPlayback(el: HTMLMediaElement): void {
  if (current && current !== el && !current.paused) current.pause();
  current = el;
}

export function releasePlayback(el: HTMLMediaElement): void {
  if (current === el) current = null;
}

/**
 * A media element's length in seconds. Recordings from MediaRecorder (WebM) and files streamed
 * without a length report `Infinity` or `NaN`, so the length we already know is used instead.
 */
export function mediaDuration(el: HTMLMediaElement | null, knownMs?: number): number {
  const d = el?.duration;
  if (d !== undefined && Number.isFinite(d) && d > 0) return d;
  return knownMs && knownMs > 0 ? knownMs / 1000 : 0;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
