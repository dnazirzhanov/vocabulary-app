import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCalendar, levelOf, shadeOf, weekProgress } from './consistency.ts';
import type { PlanDay } from './types.ts';

const day = (date: string, plan_done: boolean, cards = 20): PlanDay => ({
  date,
  active: true,
  plan_done,
  new_words: plan_done ? 5 : 2,
  target: 5,
  cards,
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

test('a month is named over the first week that starts in it, never running off the edge', () => {
  const calendar = buildCalendar([], TODAY, 12); // Mondays 17 Aug … 2 Nov
  assert.deepEqual(
    calendar.months.map((month) => [month.label, month.week, month.span]),
    [
      ['авг', 0, 3], // 17, 24, 31 Aug
      ['сент', 3, 4], // 7 Sep …
      ['окт', 7, 4], // 5 Oct …
      // 2 Nov: one week of room — left unnamed rather than cut off at the edge.
    ],
  );
});

test('shades follow the cards answered, relative to the learner’s busy days', () => {
  assert.equal(shadeOf(0, 40), 0);
  assert.deepEqual(
    [1, 10, 11, 20, 30, 40, 200].map((cards) => shadeOf(cards, 40)),
    [1, 1, 2, 2, 3, 4, 4],
  );
  const calendar = buildCalendar(
    [day('2026-11-02', true, 40), day('2026-11-03', false, 5), day('2026-11-04', true, 400)],
    TODAY,
    1,
  );
  // Too few days for a marathon to be an outlier: 400 sets the scale here.
  assert.deepEqual(
    calendar.weeks[0].slice(0, 3).map((cell) => cell.shade),
    [1, 1, 4],
  );
  assert.deepEqual([calendar.activeDays, calendar.goalDays, calendar.cards], [3, 2, 445]);
});
