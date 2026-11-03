import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dotsLabel, promiseText, weekdaysOf } from './promise.ts';

test('the promise in words: runs of three days collapse, others are listed', () => {
  assert.equal(promiseText([0, 1, 2, 3, 4]), 'Пн–Пт');
  assert.equal(promiseText([0, 2, 4]), 'Пн Ср Пт');
  assert.equal(promiseText([0, 1, 3, 4]), 'Пн Вт Чт Пт');
  assert.equal(promiseText([0, 1, 2, 4]), 'Пн–Ср Пт');
  assert.equal(promiseText([4, 0, 2]), 'Пн Ср Пт'); // order doesn't matter
  assert.equal(promiseText([5, 6]), 'Сб Вс');
  assert.equal(promiseText([0, 1, 2, 3, 4, 5, 6]), 'каждый день');
});

test("a week's yes/no flags become weekdays", () => {
  assert.deepEqual(weekdaysOf([true, false, true, false, true, false, false]), [0, 2, 4]);
});

test('a week of dots is also said in words', () => {
  assert.equal(
    dotsLabel(['done', 'missed', 'today', 'later', 'later', 'off', 'off']),
    'Неделя: Пн — сделано, Вт — пропущено, Ср — сегодня, ещё нет, Чт — впереди, Пт — впереди, Сб — не по обещанию, Вс — не по обещанию',
  );
});
