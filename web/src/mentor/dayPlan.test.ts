import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFor } from './dayPlan.ts';

const plan = [
  { title: 'Слова', minutes: 6 },
  { title: 'Чтение', minutes: 8 },
  { title: 'Письмо', minutes: 10 },
];

test('an ordinary day, a weekend and a day not yet said ask the whole plan', () => {
  for (const type of ['study', 'weekend', null] as const) assert.deepEqual(loadFor(type, plan), plan);
});

test('a light day asks about half, cut from the end', () => {
  assert.deepEqual(
    loadFor('light', plan).map((t) => t.title),
    ['Слова'],
  );
  // The first task stays even if it alone is more than half.
  assert.deepEqual(loadFor('light', [{ title: 'Эссе', minutes: 30 }, plan[0]]), [{ title: 'Эссе', minutes: 30 }]);
});

test('an exam day asks five minutes, a sick day nothing', () => {
  assert.deepEqual(loadFor('exam', plan), [{ title: 'Слова', minutes: 5 }]);
  assert.deepEqual(loadFor('sick', plan), []);
  assert.deepEqual(loadFor('light', []), []);
});
