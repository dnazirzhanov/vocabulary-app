import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLessonState, reduceLesson, type LessonAction, type LessonState } from './lessonSession.ts';
import type { ChoiceExercise } from './types.ts';

const exercises: ChoiceExercise[] = [
  {
    id: 'a',
    word: 'umbrella',
    illustration: 'umbrella',
    illustrationAlt: '',
    options: [
      { id: 'hat', label: 'шляпа' },
      { id: 'umbrella', label: 'зонт' },
    ],
    answerId: 'umbrella',
  },
  {
    id: 'b',
    word: 'key',
    illustration: 'key',
    illustrationAlt: '',
    options: [
      { id: 'key', label: 'ключ' },
      { id: 'lock', label: 'замок' },
    ],
    answerId: 'key',
  },
];

const run = (...actions: LessonAction[]): LessonState =>
  actions.reduce((state, action) => reduceLesson(state, action, exercises), createLessonState());

test('records a correct answer', () => {
  const state = run({ type: 'select', optionId: 'umbrella' }, { type: 'check' });
  assert.equal(state.phase, 'feedback');
  assert.deepEqual(state.results, [{ exerciseId: 'a', selectedId: 'umbrella', correct: true }]);
});

test('records an incorrect answer', () => {
  const state = run({ type: 'select', optionId: 'hat' }, { type: 'check' });
  assert.equal(state.results[0].correct, false);
});

test('ignores check without a selection', () => {
  const state = run({ type: 'check' });
  assert.equal(state.phase, 'answering');
  assert.equal(state.results.length, 0);
});

test('ignores options that do not belong to the current exercise', () => {
  const state = run({ type: 'select', optionId: 'key' });
  assert.equal(state.selectedId, null);
});

test('a repeated check does not record the answer twice', () => {
  const state = run({ type: 'select', optionId: 'hat' }, { type: 'check' }, { type: 'check' });
  assert.equal(state.results.length, 1);
});

test('selection is locked once the answer is checked', () => {
  const state = run({ type: 'select', optionId: 'hat' }, { type: 'check' }, { type: 'select', optionId: 'umbrella' });
  assert.equal(state.selectedId, 'hat');
});

test('a repeated continue does not skip an exercise', () => {
  const state = run(
    { type: 'select', optionId: 'umbrella' },
    { type: 'check' },
    { type: 'continue' },
    { type: 'continue' },
  );
  assert.equal(state.index, 1);
  assert.equal(state.phase, 'answering');
  assert.equal(state.selectedId, null);
});

test('completes after the last exercise and can restart', () => {
  const done = run(
    { type: 'select', optionId: 'umbrella' },
    { type: 'check' },
    { type: 'continue' },
    { type: 'select', optionId: 'lock' },
    { type: 'check' },
    { type: 'continue' },
  );
  assert.equal(done.phase, 'complete');
  assert.deepEqual(
    done.results.map((r) => r.correct),
    [true, false],
  );
  assert.deepEqual(reduceLesson(done, { type: 'restart' }, exercises), createLessonState());
});
