import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AttemptResult, CardExercise, Session } from '../lib/types.ts';
import { formatInterval, reduceCardRun, remaining, startCardRun, type CardRunState } from './cardRun.ts';

const card = (id: string, isNew = true): CardExercise => ({
  id,
  type: 'card',
  new: isNew,
  previews: [],
  word: { id, headword: id, pos: 'noun', translation: 't', example: 'e', example_ru: 'e', illustration: null },
});
const session = (cards: CardExercise[], results: AttemptResult[] = []): Session => ({
  id: 's',
  kind: 'study',
  deck_id: 'd',
  completed: false,
  exercises: cards,
  results,
});
const result = (id: string, appended: CardExercise | null = null, at: number | null = null): AttemptResult => ({
  exercise_id: id,
  rating: 3,
  next_due_at: '2026-11-03T09:00:00Z',
  appended,
  appended_index: at,
});
const run = (state: CardRunState, ...actions: Parameters<typeof reduceCardRun>[1][]) =>
  actions.reduce(reduceCardRun, state);

test('a card goes front, back, saving, then the next front', () => {
  let state = startCardRun(session([card('a'), card('b')]));
  assert.equal(state.phase, 'front');
  state = run(state, { type: 'rate', rating: 3 });
  assert.equal(state.phase, 'front', 'cannot rate before revealing');
  state = run(state, { type: 'reveal' }, { type: 'rate', rating: 3 });
  assert.deepEqual([state.phase, state.rating], ['saving', 3]);
  state = run(state, { type: 'saved', result: result('a') });
  assert.deepEqual([state.phase, state.index], ['front', 1]);
});

test('a card shown again is inserted where the server put it', () => {
  let state = startCardRun(session([card('a'), card('b'), card('c')]));
  state = run(
    state,
    { type: 'reveal' },
    { type: 'rate', rating: 1 },
    { type: 'saved', result: result('a', card('a2', false), 2) },
  );
  assert.deepEqual(
    state.cards.map((c) => c.id),
    ['a', 'b', 'a2', 'c'],
  );
  assert.deepEqual(remaining(state), { fresh: 2, review: 1 });
});

test('the last rating finishes; errors keep the rating for a retry', () => {
  let state = startCardRun(session([card('a')]));
  state = run(state, { type: 'reveal' }, { type: 'rate', rating: 2 }, { type: 'failed', message: 'offline' });
  assert.deepEqual([state.phase, state.error, state.rating], ['error', 'offline', 2]);
  state = run(state, { type: 'retry' }, { type: 'saved', result: result('a') });
  assert.equal(state.phase, 'finishing');
});

test('a resumed session starts after the last rated card', () => {
  const state = startCardRun(session([card('a'), card('b')], [result('a')]));
  assert.deepEqual([state.index, state.phase], [1, 'front']);
});

test('intervals read like Anki', () => {
  assert.equal(formatInterval(30), '<1 мин');
  assert.equal(formatInterval(600), '10 мин');
  assert.equal(formatInterval(3 * 86_400), '3 дн');
  assert.equal(formatInterval(70 * 86_400), '2 мес');
  assert.equal(formatInterval(400 * 86_400), '1.1 г');
});
