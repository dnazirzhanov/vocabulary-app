import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plural } from '../i18n/plural.ts';
import { summarizeSession } from './sessionSummary.ts';
import type { ChoiceExercise } from './types.ts';

const exercise = (id: string, translation: string): ChoiceExercise => ({
  id,
  word: id,
  illustration: 'key',
  illustrationAlt: '',
  options: [
    { id: 'right', label: translation },
    { id: 'wrong', label: 'нет' },
  ],
  answerId: 'right',
});

const exercises = [exercise('umbrella', 'зонт'), exercise('kettle', 'чайник'), exercise('key', 'ключ')];

test('splits words into missed and recognised, keeping lesson order', () => {
  const summary = summarizeSession(exercises, [
    { exerciseId: 'umbrella', selectedId: 'wrong', correct: false },
    { exerciseId: 'kettle', selectedId: 'right', correct: true },
    { exerciseId: 'key', selectedId: 'right', correct: true },
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.correctCount, 2);
  assert.deepEqual(
    summary.missed.map((w) => w.word),
    ['umbrella'],
  );
  assert.deepEqual(
    summary.recognized.map((w) => w.word),
    ['kettle', 'key'],
  );
  assert.equal(summary.missed[0].translation, 'зонт');
});

test('only counts exercises that were actually answered', () => {
  const summary = summarizeSession(exercises, [{ exerciseId: 'kettle', selectedId: 'right', correct: true }]);
  assert.equal(summary.total, 1);
  assert.deepEqual(summary.missed, []);
});

test('Russian plural forms', () => {
  const forms = { one: 'слово', few: 'слова', many: 'слов' };
  assert.deepEqual(
    [1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, forms)),
    ['слово', 'слова', 'слов', 'слов', 'слово', 'слова', 'слов'],
  );
});
