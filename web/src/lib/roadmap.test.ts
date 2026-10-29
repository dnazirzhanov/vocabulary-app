import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildRoadmap,
  calendarWeeks,
  courseFinish,
  milestones,
  restDays,
  targetOn,
  type RoadmapInput,
} from './roadmap.ts';

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

test('each day shows the running total at this pace, up to the goal', () => {
  // 10 words known already, 20 a day, every day: 30 on the first day, 50 on the next…
  const roadmap = buildRoadmap({ ...base, totalWords: 130, introduced: 10, wordsPerDay: 20 });
  const weeks = calendarWeeks(roadmap, milestones(roadmap, 130, 10));
  assert.equal(weeks.length, 1);
  const day = (n: number) => weeks.flat().find((cell) => cell.date.getDate() === n)!;
  assert.deepEqual([day(2).today, day(2).total], [true, 30]);
  assert.equal(day(3).total, 50);
  assert.deepEqual([day(7).total, day(7).finish], [130, true]);
  assert.equal(day(8).kind, 'after');
  // 30, 50, 70, 90, 110: 50 is first reached on the 3rd, 100 on the 6th.
  assert.deepEqual([day(3).milestone, day(5).milestone, day(6).milestone], [50, null, 100]);
});

test('the weeks start on the Monday of this week, whatever the day', () => {
  const roadmap = buildRoadmap({ ...base, today: new Date(2026, 9, 29), totalWords: 100 }); // a Thursday
  const [first] = calendarWeeks(roadmap);
  assert.equal(first[0].date.getDate(), 26);
  assert.deepEqual(
    first.map((cell) => cell.kind),
    ['before', 'before', 'before', 'plan', 'plan', 'plan', 'plan'],
  );
});

test('milestones mark the days round numbers are first reached, then the goal', () => {
  const input = { ...base, totalWords: 1300, introduced: 30, wordsPerDay: 20 };
  const roadmap = buildRoadmap(input);
  const marks = milestones(roadmap, 1300, 30);
  assert.deepEqual(
    marks.map((mark) => [mark.words, mark.date.getMonth(), mark.date.getDate()]),
    [
      [50, 10, 2],
      [100, 10, 5],
      [250, 10, 12],
      [500, 10, 25],
      [750, 11, 7],
      [1000, 11, 20],
      [1300, 0, 4],
    ],
  );
  assert.equal(marks[marks.length - 1].goal, true);
});

test('a long plan runs week by week to the finish week', () => {
  const roadmap = buildRoadmap({ ...base, totalWords: 1300, introduced: 30, wordsPerDay: 20 });
  const weeks = calendarWeeks(roadmap);
  assert.equal(
    weeks.at(-1)!.some((cell) => cell.finish),
    true,
  );
  assert.equal(weeks.length, 10); // 2 November to the week of 4 January
});
