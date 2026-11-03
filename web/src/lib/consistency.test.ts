import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildYear, levelOf, shadeOf, weekProgress, yearsOf } from './consistency.ts';
import type { StudyDay } from './types.ts';

const day = (date: string, studied: boolean, cards = 20): StudyDay => ({ date, active: true, studied, cards });
// Thursday 5 November 2026: its week is Monday 2 – Sunday 8 November.
const TODAY = '2026-11-05';

test('a day counts once a session is finished; answers alone are shown lightly', () => {
  assert.equal(levelOf(undefined), 0);
  assert.equal(levelOf(day('2026-11-02', false)), 1);
  assert.equal(levelOf(day('2026-11-02', true)), 2);
});

const WORKWEEK = [true, true, true, true, true, false, false];

test('the week runs Monday to Sunday and counts the promised days done so far', () => {
  const week = weekProgress(
    [
      day('2026-11-02', true),
      day('2026-11-03', false),
      day('2026-11-05', true),
      day('2026-11-01', true), // last Sunday: another week
    ],
    TODAY,
    WORKWEEK,
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
  assert.deepEqual(
    week.days.map((day) => day.promised),
    WORKWEEK,
  );
});

test('a day off studied anyway is shown done but is not counted against the promise', () => {
  const week = weekProgress([day('2026-11-07', true), day('2026-11-02', true)], '2026-11-08', WORKWEEK);
  assert.deepEqual([week.done, week.target], [1, 5]);
  assert.equal(week.days[5].level, 2);
});

test('a Sunday still belongs to the week that began on Monday', () => {
  const week = weekProgress([], '2026-11-08', WORKWEEK);
  assert.deepEqual([week.days[0].date, week.todayIndex], ['2026-11-02', 6]);
});

test('the year runs January to December, each month under its weekdays', () => {
  const year = buildYear([day('2026-11-04', true)], TODAY, 2026);
  assert.equal(year.months.length, 12);
  assert.deepEqual(
    year.months.map((month) => month.days.length),
    [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
  );
  assert.deepEqual([year.months[0].label, year.months[11].label], ['январь', 'декабрь']);
  // 1 Jan 2026 is a Thursday; 1 Nov 2026 a Sunday.
  assert.deepEqual([year.months[0].offset, year.months[10].offset], [3, 6]);
  assert.equal(year.months[10].days[3].level, 2);
  assert.equal(year.studiedDays, 1);
  // Everything after Thursday 5 November is still to come.
  assert.equal(year.months.flatMap((month) => month.days).filter((cell) => cell.future).length, 56);
});

test('the years on offer run from the first active day to this one', () => {
  assert.deepEqual(yearsOf([], TODAY), [2026]);
  assert.deepEqual(yearsOf([day('2025-12-30', false)], TODAY), [2025, 2026]);
});

test('shades follow the cards answered, relative to the learner’s busy days', () => {
  assert.equal(shadeOf(0, 40), 0);
  assert.deepEqual(
    [1, 10, 11, 20, 30, 40, 200].map((cards) => shadeOf(cards, 40)),
    [1, 1, 2, 2, 3, 4, 4],
  );
  const year = buildYear(
    [day('2026-11-02', true, 40), day('2026-11-03', false, 5), day('2026-11-04', true, 400)],
    TODAY,
    2026,
  );
  // Too few days for a marathon to be an outlier: 400 sets the scale here.
  assert.deepEqual(
    year.months[10].days.slice(1, 4).map((cell) => cell.shade),
    [1, 1, 4],
  );
  assert.deepEqual([year.activeDays, year.studiedDays, year.cards], [3, 2, 445]);
});
