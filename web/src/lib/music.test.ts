import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BARS, score, sixteenth, STEPS, TEMPO, URGENT_TEMPO } from './music.ts';

const loop = (urgent: boolean) =>
  Array.from({ length: BARS * STEPS }, (_, i) => score(Math.floor(i / STEPS), i % STEPS, urgent));

test('the kick is on every beat and nowhere else', () => {
  loop(false).forEach((hits, i) =>
    assert.equal(
      hits.some((h) => h.voice === 'kick'),
      i % 4 === 0,
    ),
  );
});

test('the last minute doubles the hi-hat and plays faster', () => {
  const hats = (urgent: boolean) => loop(urgent).filter((hits) => hits.some((h) => h.voice === 'hat')).length;
  assert.equal(hats(false), BARS * 4);
  assert.equal(hats(true), BARS * 12);
  assert.ok(URGENT_TEMPO > TEMPO);
  assert.ok(sixteenth(URGENT_TEMPO) < sixteenth(TEMPO));
});

test('every bar has a tune and a bass, and every note is in A minor', () => {
  const aMinor = new Set([9, 11, 0, 2, 4, 5, 7]); // A B C D E F G
  for (let bar = 0; bar < BARS; bar++) {
    const hits = Array.from({ length: STEPS }, (_, s) => score(bar, s, false)).flat();
    assert.ok(hits.some((h) => h.voice === 'pluck'));
    assert.ok(hits.some((h) => h.voice === 'bass'));
    for (const h of hits) if (h.midi !== undefined) assert.ok(aMinor.has(h.midi % 12), `${h.midi} in bar ${bar}`);
  }
});

test('the loop repeats every four bars', () => {
  assert.deepEqual(score(4, 3, false), score(0, 3, false));
  assert.deepEqual(score(7, 6, true), score(3, 6, true));
});
