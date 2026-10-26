import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AttemptResult, Exercise, Session, Word } from '../lib/types.ts';
import { reduceRun, responseFor, startRun, type RunAction, type RunState } from './sessionRun.ts';

const word: Word = {
  id: 'house',
  headword: 'house',
  pos: 'noun',
  translation: 'дом',
  example: 'A small house.',
  example_ru: 'Маленький дом.',
  illustration: null,
};

const exercises: Exercise[] = [
  { id: '1', type: 'introduce', word },
  {
    id: '2',
    type: 'choose_meaning',
    word: { headword: 'house', pos: 'noun', example: 'A small house.' },
    options: [
      { id: 'house', label: 'дом' },
      { id: 'door', label: 'дверь' },
    ],
  },
  { id: '3', type: 'type_word', prompt: { translation: 'дом', pos: 'noun', cloze: 'A small ____.', example_ru: '' } },
];

const session = (results: AttemptResult[] = []): Session => ({
  id: 's',
  kind: 'new',
  deck_id: 'starter',
  completed: false,
  exercises,
  results,
});

const result = (exerciseId: string, correct: boolean | null): AttemptResult => ({
  exercise_id: exerciseId,
  correct,
  correct_option_id: exerciseId === '2' ? 'house' : null,
  answer: word,
});

const run = (start: RunState, ...actions: RunAction[]) =>
  actions.reduce((state, action) => reduceRun(state, action, exercises), start);

test('an introduction advances as soon as the server acknowledges it', () => {
  const state = run(startRun(session()), { type: 'submit' }, { type: 'resolved', result: result('1', null) });
  assert.equal(state.index, 1);
  assert.equal(state.phase, 'answering');
});

test('an answer needs a choice before it can be checked', () => {
  const start = startRun(session([result('1', null)]));
  assert.equal(responseFor(exercises[1], start), null);
  assert.equal(run(start, { type: 'submit' }).phase, 'answering');
  const chosen = run(start, { type: 'choose', optionId: 'door' }, { type: 'submit' });
  assert.equal(chosen.phase, 'checking');
  assert.deepEqual(responseFor(exercises[1], chosen), { kind: 'choice', option_id: 'door' });
});

test('feedback holds until continue, and the choice is locked meanwhile', () => {
  const state = run(
    startRun(session([result('1', null)])),
    { type: 'choose', optionId: 'door' },
    { type: 'submit' },
    { type: 'resolved', result: result('2', false) },
    { type: 'choose', optionId: 'house' },
  );
  assert.equal(state.phase, 'feedback');
  assert.equal(state.choice, 'door');
  const next = run(state, { type: 'continue' }, { type: 'continue' });
  assert.equal(next.index, 2, 'a second continue does not skip an exercise');
  assert.equal(next.choice, null);
});

test('a network failure keeps the answer and retries the same request', () => {
  const failed = run(
    startRun(session([result('1', null)])),
    { type: 'choose', optionId: 'house' },
    { type: 'submit' },
    { type: 'failed', message: 'offline' },
  );
  assert.equal(failed.phase, 'error');
  assert.equal(failed.error, 'offline');
  assert.equal(failed.choice, 'house');
  assert.equal(run(failed, { type: 'retry' }).phase, 'checking');
});

test('blank typed answers cannot be submitted', () => {
  const start = startRun(session([result('1', null), result('2', true)]));
  assert.equal(run(start, { type: 'input', text: '   ' }, { type: 'submit' }).phase, 'answering');
  assert.equal(run(start, { type: 'input', text: 'house' }, { type: 'submit' }).phase, 'checking');
});

test('a stale result for another exercise is ignored', () => {
  const checking = run(
    startRun(session([result('1', null)])),
    { type: 'choose', optionId: 'house' },
    { type: 'submit' },
  );
  assert.equal(run(checking, { type: 'resolved', result: result('3', true) }).phase, 'checking');
});

test('the last answer leads to finishing, and a failed finish can be retried', () => {
  const finishing = run(
    startRun(session([result('1', null), result('2', true)])),
    { type: 'input', text: 'house' },
    { type: 'submit' },
    { type: 'resolved', result: result('3', true) },
    { type: 'continue' },
  );
  assert.equal(finishing.phase, 'finishing');
  const failed = run(finishing, { type: 'failed', message: 'offline' });
  assert.equal(failed.failed, 'finish');
  assert.equal(run(failed, { type: 'retry' }).phase, 'finishing');
});

test('resuming starts after the last answered exercise', () => {
  assert.equal(startRun(session([result('1', null)])).index, 1);
  assert.equal(startRun(session([result('1', null), result('2', true), result('3', true)])).phase, 'finishing');
});

test('a recall exercise reveals its options before anything can be chosen or sent', () => {
  const recall: Exercise = {
    id: '1',
    type: 'recall_meaning',
    word: { headword: 'house', pos: 'noun', example: 'A small house.' },
    options: [
      { id: 'house', label: 'дом' },
      { id: 'door', label: 'дверь' },
    ],
  };
  const reviewExercises = [recall];
  const review: Session = { ...session(), kind: 'review', exercises: reviewExercises };
  const go = (start: RunState, ...actions: RunAction[]) =>
    actions.reduce((state, action) => reduceRun(state, action, reviewExercises), start);

  const hidden = go(startRun(review), { type: 'choose', optionId: 'house' });
  assert.equal(hidden.choice, null, 'options cannot be picked while hidden');
  assert.equal(responseFor(recall, hidden), null);

  const revealed = go(hidden, { type: 'submit' });
  assert.equal(revealed.phase, 'answering', 'revealing sends nothing');
  assert.equal(revealed.revealed, true);

  const checking = go(revealed, { type: 'choose', optionId: 'house' }, { type: 'submit' });
  assert.equal(checking.phase, 'checking');
  assert.deepEqual(responseFor(recall, checking), { kind: 'choice', option_id: 'house' });
});
