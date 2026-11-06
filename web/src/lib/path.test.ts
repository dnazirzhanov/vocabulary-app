import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPath, hopsBetween } from './path.ts';
import type { DeckWord, WordStatus } from './types.ts';

const NOW = new Date('2026-11-10T09:00:00Z');
const word = (position: number, status: WordStatus, nextReview: string | null = null): DeckWord => ({
  position,
  status,
  next_review_at: nextReview,
  word: {
    id: `w${position}`,
    headword: `w${position}`,
    pos: 'noun',
    translation: 't',
    example: 'e',
    example_translation: 'e',
    language: 'ru',
    illustration: null,
  },
});
const deck = (statuses: WordStatus[]) => statuses.map((status, index) => word(index, status));
const repeat = (status: WordStatus, n: number) => Array<WordStatus>(n).fill(status);

test('a new learner stands on the first stone; the rest are locked', () => {
  const path = buildPath(deck(repeat('not_started', 30)), NOW);
  assert.equal(path.stones.length, 6);
  assert.deepEqual(
    path.levels.map((level) => level.stones.map((stone) => stone.number)),
    [
      [1, 2],
      [3, 4],
      [5, 6],
    ],
  );
  assert.deepEqual(
    path.stones.map((stone) => stone.state),
    ['current', 'locked', 'locked', 'locked', 'locked', 'locked'],
  );
  assert.equal(path.current?.number, 1);
});

test('a stone is done when all its words are met, firm when all are remembered well', () => {
  const statuses = [
    ...repeat('well_learned', 5),
    ...repeat('learning', 5),
    'new',
    'new',
    'new',
    ...repeat('not_started', 17),
  ];
  const path = buildPath(deck(statuses as WordStatus[]), NOW);
  assert.deepEqual(
    path.stones.slice(0, 4).map((stone) => stone.state),
    ['firm', 'done', 'current', 'locked'],
  );
  assert.equal(path.current?.number, 3);
  assert.equal(path.current?.met, 3);
});

test('due reviews are counted per stone', () => {
  const words = deck(repeat('not_started', 10));
  words[0] = word(0, 'learning', '2026-11-09T09:00:00Z');
  words[1] = word(1, 'learning', '2026-11-11T09:00:00Z');
  assert.equal(buildPath(words, NOW).stones[0].due, 1);
});

test('a finished deck keeps the learner on the last stone', () => {
  const path = buildPath(deck(repeat('new', 30)), NOW);
  assert.equal(path.complete, true);
  assert.equal(path.current?.number, 6);
  assert.ok(path.stones.every((stone) => stone.state === 'done'));
});

test('the last stone may hold fewer words', () => {
  const path = buildPath(deck(repeat('new', 12)), NOW);
  assert.deepEqual(
    path.stones.map((stone) => stone.words.length),
    [5, 5, 2],
  );
});

test('one hop per stone left behind, none on the first visit', () => {
  assert.deepEqual(hopsBetween(null, 3), []);
  assert.deepEqual(hopsBetween(2, 2), []);
  assert.deepEqual(hopsBetween(1, 3), [2, 3]);
});
