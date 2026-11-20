import assert from 'node:assert/strict';
import { test } from 'node:test';
import { minimumOf, rescueChoices } from './rescue.ts';
import { dayEndFor } from './slots.ts';

const TASKS = [
  { title: 'Слова', minutes: 8 },
  { title: 'Эссе', minutes: 15 },
];
const GYM = { start: 18 * 60, end: 19 * 60 };
const at = (h: number, m = 0) => h * 60 + m;

test('the minimum keeps the planned time while it is ahead, else comes now', () => {
  // The owner's case: 14:25, planned for 21:00.
  const early = rescueChoices(TASKS, [GYM], at(14, 25), at(21), at(23));
  assert.deepEqual(early.minimum, { task: { title: 'Слова', minutes: 5 }, start: at(21) });
  const late = rescueChoices(TASKS, [GYM], at(21, 30), at(21), at(23));
  assert.equal(late.minimum?.start, at(21, 30));
});

test('other times are real free times, before and after the plan, up to bedtime', () => {
  const { times, total } = rescueChoices(TASKS, [GYM], at(14, 25), at(21), at(23));
  assert.equal(total, 23);
  assert.ok(times.length > 1 && times.length <= 4);
  assert.ok(times.some((t) => t < at(21)) && times.some((t) => t > at(21)), 'both sides of 21:00');
  for (const t of times) {
    assert.ok(t >= at(14, 30) && t + total <= at(23), `${t} inside the day`);
    assert.ok(t + total + 10 <= GYM.start || t >= GYM.end + 10, `${t} clear of the gym`);
    assert.notEqual(t, at(21));
  }
});

test('after the planned time it still offers later tonight (no fixed 22:00)', () => {
  const { times } = rescueChoices(TASKS, [], at(21, 30), at(21), at(23));
  assert.deepEqual(times, [at(21, 30), at(22), at(22, 30)]); // from now on, up to 23:00
});

test('bedtime is the sleep block, else 23:00; nothing fits, nothing offered', () => {
  assert.equal(
    dayEndFor([
      { start: at(22, 30), kind: 'sleep' },
      { start: at(8), kind: 'school' },
    ]),
    at(22, 30),
  );
  assert.equal(dayEndFor([{ start: at(8), kind: 'school' }]), at(23));
  const none = rescueChoices(TASKS, [], at(22, 58), at(21), at(23));
  assert.deepEqual([none.times, none.minimum], [[], null]);
});

test('an empty plan asks nothing', () => {
  assert.deepEqual(rescueChoices([], [], at(10), at(21), at(23)), { minimum: null, times: [], total: 0 });
  assert.deepEqual(minimumOf([]), []);
});
