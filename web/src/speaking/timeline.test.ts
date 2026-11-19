import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isFiller, pausesOf, seconds, timeline, type TimedWord } from './timeline.ts';

const w = (word: string, start: number, end: number): TimedWord => ({ word, start_ms: start, end_ms: end });

const WORDS = [w('I', 0, 200), w('think', 250, 500), w('the', 550, 650), w('best', 700, 1000), w('place', 1900, 2200)];

test('a pause shows where it happened, between the words around it', () => {
  const pieces = timeline(WORDS, [{ start_ms: 1000, ms: 900, kind: 'silent', inside_phrase: true }]);
  assert.deepEqual(
    pieces.map((p) => (p.kind === 'word' ? p.text : p.kind)),
    ['I', 'think', 'the', 'best', 'pause', 'place'],
  );
  const pause = pieces.find((p) => p.kind === 'pause');
  assert.deepEqual(pause, { kind: 'pause', ms: 900, inside: true });
});

test('an «um» found only in the audio is marked; one Whisper also wrote shows once', () => {
  const heard = [{ start_ms: 1300, ms: 300, kind: 'filled' as const, inside_phrase: true }];
  assert.deepEqual(
    timeline(WORDS, heard).map((p) => p.kind),
    ['word', 'word', 'word', 'word', 'filler', 'word'],
  );
  const written = [...WORDS.slice(0, 4), w('um,', 1250, 1550), WORDS[4]];
  const pieces = timeline(written, heard);
  assert.equal(pieces.filter((p) => p.kind === 'filler').length, 1);
  assert.deepEqual(pieces[4], { kind: 'filler', text: 'um,' });
});

test('an old assessment without pauses shows the words alone', () => {
  assert.deepEqual(pausesOf({ wpm: 120 }), []);
  assert.deepEqual(pausesOf(undefined), []);
  assert.equal(timeline(WORDS, pausesOf({})).length, WORDS.length);
});

test('malformed pauses are ignored', () => {
  assert.equal(pausesOf({ pauses: [{ start_ms: 'x' }, null, { start_ms: 1, ms: 2, kind: 'silent' }] }).length, 1);
});

test('fillers are recognised with their punctuation, real words are not', () => {
  assert.ok(isFiller('Um,'));
  assert.ok(isFiller('uh…'));
  assert.ok(!isFiller('umbrella'));
});

test('seconds use the locale’s decimal separator', () => {
  assert.equal(seconds(1400, 'ru-RU'), '1,4');
  assert.equal(seconds(1400, 'en-US'), '1.4');
});
