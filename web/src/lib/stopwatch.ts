/**
 * A count-up timer (Writing's optional one, Reading's), as plain functions so it can be tested without a browser.
 *
 * It counts up, never starts by itself, and never limits anything. Time is worked out from clock
 * readings rather than counted tick by tick, so a phone that sleeps mid-answer does not lose or
 * gain seconds.
 */
export interface Stopwatch {
  /** Seconds banked from earlier runs. */
  banked: number;
  /** When the current run began (ms), or null while stopped. */
  since: number | null;
  /** Has it ever been started? A learner who never touched it submits no time at all. */
  used: boolean;
}

export const idle: Stopwatch = { banked: 0, since: null, used: false };

export const start = (watch: Stopwatch, now: number): Stopwatch =>
  watch.since === null ? { ...watch, since: now, used: true } : watch;

export const stop = (watch: Stopwatch, now: number): Stopwatch =>
  watch.since === null ? watch : { ...watch, banked: elapsed(watch, now), since: null };

/** Whole seconds so far. */
export const elapsed = (watch: Stopwatch, now: number): number =>
  watch.banked + (watch.since === null ? 0 : Math.max(0, Math.floor((now - watch.since) / 1000)));

/** What to send with the answer: the time if the timer was used, otherwise nothing. */
export const timeToSubmit = (watch: Stopwatch, now: number): number | null => (watch.used ? elapsed(watch, now) : null);

export const clock = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};
