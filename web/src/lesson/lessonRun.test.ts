import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AttemptResult, CardExercise, Exercise, Session, SpellingExercise } from '../lib/types.ts';
import { formatInterval, reduceLesson, remaining, startLesson, type LessonState } from './lessonRun.ts';

const card = (id: string, isNew = true): CardExercise => ({
  id,
  type: 'card',
  new: isNew,
  previews: [],
  word: { id, headword: id, pos: 'noun', translation: 't', example: 'e', example_ru: 'e', illustration: null },
});
const spelling = (id: string): SpellingExercise => ({
  id,
  type: 'spelling',
  prompt: { translation: 'дом', pos: 'noun' },
  slots: 5,
  separators: [],
  tiles: [],
  hint: null,
});
const session = (cards: Exercise[], results: AttemptResult[] = []): Session => ({
  id: 's',
  kind: 'study',
  deck_id: 'd',
  completed: false,
  exercises: cards,
  results,
});
const result = (id: string, inserted: AttemptResult['inserted'] = []): AttemptResult => ({
  exercise_id: id,
  rating: 3,
  next_due_at: '2026-11-03T09:00:00Z',
  correct: null,
  answer: null,
  inserted,
});
const run = (state: LessonState, ...actions: Parameters<typeof reduceLesson>[1][]) =>
  actions.reduce(reduceLesson, state);

test('a card goes front, back, saving, then the next front', () => {
  let state = startLesson(session([card('a'), card('b')]));
  assert.equal(state.phase, 'front');
  state = run(state, { type: 'rate', rating: 3 });
  assert.equal(state.phase, 'front', 'cannot rate before revealing');
  state = run(state, { type: 'reveal' }, { type: 'rate', rating: 3 });
  assert.deepEqual([state.phase, state.pending], ['saving', { kind: 'rating', rating: 3 }]);
  state = run(state, { type: 'saved', result: result('a') });
  assert.deepEqual([state.phase, state.index], ['front', 1]);
});

test('a card shown again is inserted where the server put it', () => {
  let state = startLesson(session([card('a'), card('b'), card('c')]));
  state = run(
    state,
    { type: 'reveal' },
    { type: 'rate', rating: 1 },
    { type: 'saved', result: result('a', [{ index: 2, exercise: card('a2', false) }]) },
  );
  assert.deepEqual(
    state.exercises.map((c) => c.id),
    ['a', 'b', 'a2', 'c'],
  );
  assert.deepEqual(remaining(state), { fresh: 2, review: 1, spelling: 0 });
});

test('the last rating finishes; errors keep the rating for a retry', () => {
  let state = startLesson(session([card('a')]));
  state = run(state, { type: 'reveal' }, { type: 'rate', rating: 2 }, { type: 'failed', message: 'offline' });
  assert.deepEqual([state.phase, state.error, state.pending], ['error', 'offline', { kind: 'rating', rating: 2 }]);
  state = run(state, { type: 'retry' }, { type: 'saved', result: result('a') });
  assert.equal(state.phase, 'finishing');
});

test('a resumed session starts after the last rated card', () => {
  const state = startLesson(session([card('a'), card('b')], [result('a')]));
  assert.deepEqual([state.index, state.phase], [1, 'front']);
});

test('intervals read like Anki', () => {
  assert.equal(formatInterval(30), '<1 мин');
  assert.equal(formatInterval(600), '10 мин');
  assert.equal(formatInterval(3 * 86_400), '3 дн');
  assert.equal(formatInterval(70 * 86_400), '2 мес');
  assert.equal(formatInterval(400 * 86_400), '1.1 г');
});

test('a spelling answer is checked, then explained before moving on', () => {
  let state = startLesson(session([spelling('s1'), spelling('s2')]));
  state = run(state, { type: 'reveal' }, { type: 'rate', rating: 3 });
  assert.equal(state.phase, 'front', 'no reveal or rating for spelling');
  state = run(state, { type: 'spell', answer: 'huose' });
  assert.deepEqual(state.pending, { kind: 'spelling', answer: 'huose' });
  const missed = { ...result('s1'), rating: null, correct: false, answer: 'house' };
  state = run(state, { type: 'saved', result: missed });
  assert.deepEqual([state.phase, state.index, state.last?.answer], ['feedback', 0, 'house']);
  state = run(state, { type: 'continue' });
  assert.deepEqual([state.phase, state.index], ['front', 1]);
});
