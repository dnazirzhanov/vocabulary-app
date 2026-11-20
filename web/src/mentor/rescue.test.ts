import assert from 'node:assert/strict';
import { test } from 'node:test';
import { minimumOf, rescueOptions } from './rescue.ts';

const TASKS = [
  { title: 'Слова', minutes: 8 },
  { title: 'Эссе', minutes: 15 },
];
const GYM = { start: 18 * 60, end: 19 * 60 };

test('three ways out, each showing the day before and after', () => {
  const [minimum, later, skip] = rescueOptions(TASKS, [GYM], 17 * 60 + 2, 19 * 60);
  // Before: the plan as it stood, from the promised 19:00 → after the gym.
  assert.deepEqual(
    minimum.before.map((l) => l.at),
    [19 * 60 + 10, 19 * 60 + 18],
  );
  // The minimum: five minutes of the first task, right now.
  assert.deepEqual(minimum.after, [{ title: 'Слова', at: 17 * 60 + 5, minutes: 5 }]);
  // Later: an hour on at least, the whole plan, around the gym.
  assert.equal(later.mode, 'moved');
  assert.equal(later.start, 19 * 60 + 10);
  assert.deepEqual(
    later.after.map((l) => l.at),
    [19 * 60 + 10, 19 * 60 + 18],
  );
  // Tomorrow: nothing today.
  assert.deepEqual([skip.mode, skip.after], ['skip', []]);
});

test('late at night only tomorrow is left', () => {
  const options = rescueOptions(TASKS, [], 21 * 60 + 58, null);
  assert.deepEqual(
    options.map((o) => o.mode),
    ['skip'],
  );
});

test('the minimum keeps the first task, never longer than five minutes', () => {
  assert.deepEqual(minimumOf([{ title: 'Чтение', minutes: 3 }, ...TASKS]), [{ title: 'Чтение', minutes: 3 }]);
  assert.deepEqual(minimumOf(TASKS), [{ title: 'Слова', minutes: 5 }]);
  assert.deepEqual(minimumOf([]), []);
});
