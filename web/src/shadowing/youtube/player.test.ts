import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EARLY_MS, segmentClock } from './player.ts';

/**
 * A player like YouTube's: it plays from `from`, but says where it is only every `every` ms, and for
 * `lag` ms after the seek still says where it was before. Returns when the clock paused it.
 */
function play(from: number, end: number, opts: { every: number; lag: number; before: number; rate?: number }) {
  const rate = opts.rate ?? 1;
  let now = 0;
  const watch = segmentClock(from, end, rate, () => now);
  let reported = opts.before;
  for (; now < 20_000; now += 20) {
    const position = from + now * rate;
    // Its reports don't fall on the sentence's end: here 120 ms after each quarter second.
    if (now >= opts.lag && (now - 120) % opts.every === 0) reported = position;
    if (watch.shouldStop(true, reported)) return from + now * rate;
  }
  return Infinity;
}

test('a sentence stops on time although the player reports its time only four times a second', () => {
  const stopped = play(10_000, 12_000, { every: 250, lag: 0, before: 0 });
  assert.ok(stopped >= 12_000 - EARLY_MS - 25 && stopped <= 12_000, String(stopped));
});

test('played again after a later sentence, it doesn’t stop at once', () => {
  // The player still says 30 s (where the later sentence ended) for 300 ms after the seek back.
  const stopped = play(10_000, 12_000, { every: 250, lag: 300, before: 30_000 });
  assert.ok(stopped >= 12_000 - EARLY_MS - 25, String(stopped));
});

test('the same sentence again: its own end is not taken for where it is', () => {
  const stopped = play(10_000, 11_500, { every: 250, lag: 300, before: 11_500 - EARLY_MS });
  assert.ok(stopped >= 11_500 - EARLY_MS - 25, String(stopped));
});

test('faster or slower, it still stops at the end', () => {
  for (const rate of [0.5, 0.75, 1.25, 1.5]) {
    const stopped = play(5_000, 8_000, { every: 250, lag: 0, before: 0, rate });
    assert.ok(stopped >= 8_000 - EARLY_MS - 40 && stopped <= 8_000, `${rate}: ${stopped}`);
  }
});

test('while buffering, nothing stops', () => {
  const watch = segmentClock(1_000, 2_000, 1, () => 5_000);
  assert.equal(watch.shouldStop(false, 3_000), false);
});

test('the speed changed in the middle of a sentence: it still stops at the end', () => {
  // 0.75× for the first second, then 1.5×; the player reports every 250 ms.
  let now = 0;
  const watch = segmentClock(10_000, 14_000, 0.75, () => now);
  let position = 10_000;
  let rate = 0.75;
  let reported = 10_000;
  for (; now < 20_000; now += 20) {
    if (now === 1_000) {
      rate = 1.5;
      watch.setRate(1.5);
    }
    position += 20 * rate;
    if ((now - 120) % 250 === 0) reported = position;
    if (watch.shouldStop(true, reported)) break;
  }
  assert.ok(position >= 14_000 - EARLY_MS - 40 && position <= 14_000, String(position));
});
