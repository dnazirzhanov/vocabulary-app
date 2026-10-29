import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCalendar, levelOf, weekProgress } from './consistency.ts';
import type { PlanDay } from './types.ts';

const day = (date: string, plan_done: boolean): PlanDay => ({
  date,
  active: true,
  plan_done,
  new_words: plan_done ? 5 : 2,
  target: 5,
});
// Thursday 5 November 2026: its week is Monday 2 – Sunday 8 November.
const TODAY = '2026-11-05';

test('a day counts once its plan is done; some learning is shown lightly', () => {
  assert.equal(levelOf(undefined), 0);
  assert.equal(levelOf(day('2026-11-02', false)), 1);
  assert.equal(levelOf(day('2026-11-02', true)), 2);
});

test('the week runs Monday to Sunday and counts goal days so far', () => {
  const week = weekProgress(
    [
      day('2026-11-02', true),
      day('2026-11-03', false),
      day('2026-11-05', true),
      day('2026-11-01', true), // last Sunday: another week
    ],
    TODAY,
    5,
  );
  assert.deepEqual(
    week.days.map((day) => day.date),
    ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'],
  );
  assert.deepEqual(
    week.days.map((day) => day.level),
    [2, 1, 0, 2, 0, 0, 0],
  );
  assert.deepEqual(
    week.days.map((day) => day.future),
    [false, false, false, false, true, true, true],
  );
  assert.deepEqual([week.done, week.target, week.todayIndex], [2, 5, 3]);
});

test('a Sunday still belongs to the week that began on Monday', () => {
  const week = weekProgress([], '2026-11-08', 5);
  assert.deepEqual([week.days[0].date, week.todayIndex], ['2026-11-02', 6]);
});

test('the calendar ends with the current week and fills the gaps with empty days', () => {
  const calendar = buildCalendar([day('2026-11-04', true)], TODAY, 4);
  assert.equal(calendar.weeks.length, 4);
  assert.ok(calendar.weeks.every((week) => week.length === 7));
  assert.equal(calendar.weeks[0][0].date, '2026-10-12');
  assert.equal(calendar.weeks[3][6].date, '2026-11-08');
  assert.equal(calendar.weeks[3][2].level, 2);
  assert.equal(calendar.goalDays, 1);
  assert.equal(calendar.weeks.flat().filter((cell) => cell.future).length, 3);
});

test('month names sit over the week with the first of the month and never crowd each other', () => {
  const calendar = buildCalendar([], TODAY, 12); // 17 Aug to 8 Nov
  assert.deepEqual(
    calendar.months.map((month) => month.week),
    [2, 6, 10], // 1 Sep (Tue), 1 Oct (Thu), 1 Nov (Sun)
  );
  assert.equal(calendar.months.length, 3);
  // Two firsts a week apart: only the earlier one is named.
  const tight = buildCalendar([], '2026-03-01', 2); // 23 Feb – 1 Mar: both inside two weeks
  assert.ok(tight.months.length <= 1);
});
