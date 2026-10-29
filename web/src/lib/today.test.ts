import assert from 'node:assert/strict';
import { test } from 'node:test';
import { courseCounts, currentDeck, lessonDecks, newInSession, nextDueAt, studyLabel } from './today.ts';
import type { Deck, Pace } from './types.ts';

const deck = (id: string, fields: Partial<Deck> = {}): Deck => ({
  id,
  kind: 'course',
  group_name: null,
  title: id,
  description: '',
  level: null,
  level_order: 0,
  locked: false,
  course_goal: null,
  word_count: 100,
  introduced_count: 0,
  due_count: 0,
  learning_count: 0,
  review_count: 0,
  new_today: 0,
  next_due_at: null,
  ...fields,
});
const pace = (fields: Partial<Pace> = {}): Pace => ({
  deck_id: 'a',
  target: 5,
  effective_target: 5,
  ramp_week: null,
  new_words_today: 0,
  remaining_today: 5,
  next_lesson_size: 5,
  bonus: false,
  blocked_by_reviews: false,
  due_count: 0,
  review_debt_limit: 50,
  seconds_per_exercise: 10,
  suggestion: null,
  ...fields,
});

test('the course counts add up every level', () => {
  const decks = [
    deck('a', { new_today: 5, learning_count: 2, review_count: 20 }),
    deck('b', { review_count: 3 }),
    deck('c', { locked: true }),
  ];
  assert.deepEqual(courseCounts(decks), { fresh: 5, learning: 2, review: 23 });
});

test('the current level is the last one open', () => {
  assert.equal(currentDeck([deck('a'), deck('b', { locked: true })])?.id, 'a');
  assert.equal(currentDeck([deck('a'), deck('b'), deck('c', { locked: true })])?.id, 'b');
  assert.equal(currentDeck([]), undefined);
});

test("a teacher's deck is never the current level, but its words come first", () => {
  const given = deck('g', { kind: 'group', group_name: '7Б', word_count: 3 });
  const decks = [given, deck('a'), deck('b', { locked: true })];
  assert.equal(currentDeck(decks)?.id, 'a');
  assert.deepEqual(
    lessonDecks(decks).map((d) => d.id),
    ['g', 'a'],
  );
  // Three of the teacher's words and the level's together fill a lesson of five.
  assert.equal(newInSession([given, deck('a', { introduced_count: 98 })], pace()), 5);
});

test('the next review is the earliest of every deck', () => {
  const decks = [
    deck('a', { next_due_at: '2026-11-03T09:00:00Z' }),
    deck('b', { next_due_at: '2026-11-02T18:00:00Z' }),
    deck('c'),
  ];
  assert.equal(nextDueAt(decks), '2026-11-02T18:00:00Z');
  assert.equal(nextDueAt([deck('a')]), null);
});

test('a session brings new words while some are left and reviews are under control', () => {
  assert.equal(newInSession([deck('a')], pace()), 5);
  assert.equal(newInSession([deck('a', { introduced_count: 98 })], pace()), 2);
  assert.equal(newInSession([deck('a', { introduced_count: 100 })], pace()), 0);
  // The brake counts reviews of every level, so it holds even for a deck with nothing due.
  assert.equal(newInSession([deck('a')], pace({ blocked_by_reviews: true })), 0);
});

test('the study button says what the session holds', () => {
  assert.equal(studyLabel({ due: 0, fresh: 5, started: false, bonus: false }), 'Начать урок · 5\u00a0слов');
  assert.equal(studyLabel({ due: 4, fresh: 5, started: true, bonus: false }), 'Учить · 4 повт. + 5 нов.');
  assert.equal(studyLabel({ due: 3, fresh: 0, started: true, bonus: false }), 'Повторить · 3\u00a0слова');
  assert.equal(studyLabel({ due: 0, fresh: 5, started: true, bonus: true }), 'Ещё 5\u00a0слов');
  assert.equal(studyLabel({ due: 0, fresh: 0, started: true, bonus: false }), null);
});
