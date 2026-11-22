import assert from 'node:assert/strict';
import { test } from 'node:test';
import { busyNow, freeUntil, nextFree, slotsFor } from './slots.ts';

const SCHOOL = { start: 8 * 60, end: 14 * 60 };
const GYM = { start: 18 * 60, end: 19 * 60 };

test('a task goes in the next free gap, with air around each block', () => {
  assert.equal(nextFree([SCHOOL], 9 * 60, 20), 14 * 60 + 10);
  // 20 minutes fit before the gym with 10 minutes to spare, 50 do not.
  assert.equal(nextFree([GYM], 17 * 60 + 30, 20), 17 * 60 + 30);
  assert.equal(nextFree([GYM], 17 * 60 + 30, 50), 19 * 60 + 10);
  // Nothing before 07:00, nothing past 22:00.
  assert.equal(nextFree([], 5 * 60, 10), 7 * 60);
  assert.equal(nextFree([], 21 * 60 + 55, 10), null);
});

test('tasks follow one another from the promised study time when it is still ahead', () => {
  const tasks = [{ minutes: 8 }, { minutes: 6 }, { minutes: 15 }];
  assert.deepEqual(slotsFor(tasks, [SCHOOL, GYM], 15 * 60 + 2, 19 * 60 + 30), [1170, 1178, 1184]);
  // From now when the study time has passed, rounded to five minutes, around the gym.
  assert.deepEqual(slotsFor(tasks, [GYM], 17 * 60 + 33, 9 * 60), [1055, 1063, 19 * 60 + 10]);
});

test('a task that no longer fits today has no time', () => {
  assert.deepEqual(slotsFor([{ minutes: 10 }, { minutes: 30 }], [], 21 * 60 + 40, null), [21 * 60 + 40, null]);
});

test('free until the next block, and the block the learner is in', () => {
  assert.equal(freeUntil([SCHOOL, GYM], 15 * 60), 18 * 60);
  assert.equal(freeUntil([SCHOOL], 15 * 60), 22 * 60);
  assert.deepEqual(busyNow([SCHOOL, GYM], 10 * 60), SCHOOL);
  assert.equal(busyNow([SCHOOL, GYM], 14 * 60), null);
});
