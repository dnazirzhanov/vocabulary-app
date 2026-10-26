import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRoadmap, courseFinish, restDays, targetOn, type RoadmapInput } from './roadmap.ts';

// Monday 2 November 2026.
const MONDAY = new Date(2026, 10, 2);
const day = (offset: number) => new Date(2026, 10, 2 + offset);
const base: RoadmapInput = {
  today: MONDAY,
  totalWords: 30,
  introduced: 0,
  metToday: 0,
  wordsPerDay: 5,
  studyDaysPerWeek: 7,
  ramp: false,
  rampStartedOn: null,
};

test('rest days come from the weekend first', () => {
  assert.deepEqual([...restDays(7)], []);
  assert.deepEqual([...restDays(6)], [0]);
  assert.deepEqual([...restDays(5)].sort(), [0, 6]);
});

test('every day at 5 words: 30 words take 6 days', () => {
  const plan = buildRoadmap(base);
  assert.deepEqual(plan.finish, day(5));
  assert.equal(plan.days[5].met, 30);
});

test('rest days push the finish back', () => {
  // Mon–Fri, then the weekend off, then Monday.
  assert.deepEqual(buildRoadmap({ ...base, studyDaysPerWeek: 5 }).finish, day(7));
});

test("today's target counts words already met today", () => {
  const plan = buildRoadmap({ ...base, introduced: 3, metToday: 3 });
  assert.equal(plan.days[0].newWords, 2);
  assert.equal(plan.days[0].met, 5);
});

test('the ramp lowers the first two weeks of a large target', () => {
  const input = { ...base, totalWords: 1000, wordsPerDay: 20, ramp: true, rampStartedOn: MONDAY };
  assert.equal(targetOn(day(0), input), 10);
  assert.equal(targetOn(day(7), input), 15);
  assert.equal(targetOn(day(14), input), 20);
  const plan = buildRoadmap(input);
  assert.deepEqual(
    plan.weeks.slice(0, 3).map((week) => [week.newWords, week.dailyTarget]),
    [
      [70, 10],
      [105, 15],
      [140, 20],
    ],
  );
});

test('words are well remembered after three on-time reviews', () => {
  // Met on day 0 → reviews on days 1, 4 and 11.
  const plan = buildRoadmap({ ...base, totalWords: 5 });
  assert.deepEqual(plan.finish, day(0));
  assert.deepEqual(plan.allFirm, day(11));
  assert.equal(plan.days[10].firm, 0);
  assert.equal(plan.days[11].firm, 5);
});

test('a review due on a rest day waits for the next study day', () => {
  // Saturday 7 November: reviews due Sun (rest) → Mon 9, then Thu 12, then Thu 19.
  const saturday = day(5);
  const plan = buildRoadmap({ ...base, today: saturday, totalWords: 5, studyDaysPerWeek: 6 });
  assert.deepEqual(plan.allFirm, day(17));
});

test('month rows mark each month end until the finish', () => {
  const plan = buildRoadmap({ ...base, totalWords: 200 });
  assert.deepEqual(
    plan.months.map((row) => [row.date.getMonth(), row.date.getDate(), row.met]),
    [
      [10, 30, 145],
      [11, 11, 200],
    ],
  );
});

test('the whole course is projected at the same pace', () => {
  assert.deepEqual(courseFinish({ ...base, introduced: 30 }, 1300), day(253));
  assert.equal(courseFinish({ ...base, introduced: 30 }, 30), null);
});

test('nothing left to learn: no finish date', () => {
  const plan = buildRoadmap({ ...base, introduced: 30 });
  assert.equal(plan.finish, null);
  assert.equal(plan.weeks.length, 0);
});
