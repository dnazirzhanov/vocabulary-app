import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCalendar, levelOf, weekProgress } from './consistency.ts';

const GOAL = 30;
// Thursday 5 November 2026: its week is Monday 2 – Sunday 8 November.
const TODAY = '2026-11-05';

test('a day is practised below the goal and counts once the goal is met', () => {
  assert.deepEqual(
    [0, 5, 29, 30, 80].map((points) => levelOf(points, GOAL)),
    [0, 1, 1, 2, 2],
  );
});

test('the week runs Monday to Sunday and counts goal days so far', () => {
  const week = weekProgress(
    [
      { date: '2026-11-02', points: 50 },
      { date: '2026-11-03', points: 10 },
      { date: '2026-11-05', points: 30 },
      { date: '2026-11-01', points: 90 }, // last Sunday: another week
    ],
    GOAL,
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
  const week = weekProgress([], GOAL, '2026-11-08', 5);
  assert.deepEqual([week.days[0].date, week.todayIndex], ['2026-11-02', 6]);
});

test('the calendar ends with the current week and fills the gaps with empty days', () => {
  const calendar = buildCalendar([{ date: '2026-11-04', points: 40 }], GOAL, TODAY, 4);
  assert.equal(calendar.weeks.length, 4);
  assert.ok(calendar.weeks.every((week) => week.length === 7));
  assert.equal(calendar.weeks[0][0].date, '2026-10-12');
  assert.equal(calendar.weeks[3][6].date, '2026-11-08');
  assert.equal(calendar.weeks[3][2].level, 2);
  assert.equal(calendar.goalDays, 1);
  assert.equal(calendar.weeks.flat().filter((cell) => cell.future).length, 3);
});

test('month names sit over the week with the first of the month and never crowd each other', () => {
  const calendar = buildCalendar([], GOAL, TODAY, 12); // 17 Aug to 8 Nov
  assert.deepEqual(
    calendar.months.map((month) => month.week),
    [2, 6, 10], // 1 Sep (Tue), 1 Oct (Thu), 1 Nov (Sun)
  );
  assert.equal(calendar.months.length, 3);
  // Two firsts a week apart: only the earlier one is named.
  const tight = buildCalendar([], GOAL, '2026-03-01', 2); // 23 Feb – 1 Mar: both inside two weeks
  assert.ok(tight.months.length <= 1);
});
