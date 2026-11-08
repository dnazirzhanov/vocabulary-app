import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { deadlineShare, planCards, planDay, rampWeek, requeue, type Step } from './plan.ts';
import { previews, review, type CardState } from './schedule.ts';
import { afterSpelling, letters, normalize, overview, pick, separators, type Mode, type Spelled } from './spelling.ts';
import { dayStart, localDate, localDayBounds, studyDay } from './time.ts';
import { nextInterval, type Rating } from './fsrs.ts';

/**
 * The device's study engine against the server's own answers (backend/tests/study_vectors.py
 * writes vectors.json by running the Python code; ADR 0062). Any difference fails here.
 */
const vectors = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));

type CardRow = [number, number | null, number | null, number | null, number, number | null] | null;
const card = (row: CardRow): CardState | null =>
  row && {
    state: row[0],
    step: row[1],
    stability: row[2],
    difficulty: row[3],
    dueAt: row[4],
    lastReviewedAt: row[5],
  };
const close = (a: number | null, b: number | null, what: string) => {
  if (a === null || b === null) return assert.equal(a, b, what);
  assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`);
};

test('intervals that land on half a day round as Python rounds them (to the even day)', () => {
  const halves = (vectors.intervals as [number, number][]).filter(
    ([stability, days]) => days !== Math.round(stability),
  );
  assert.ok(halves.length > 0, 'some cases must tell the two roundings apart');
  for (const [stability, days] of vectors.intervals as [number, number][]) {
    assert.equal(nextInterval(stability), days, `stability ${stability}`);
  }
});

test('card schedules: FSRS and the day rules, as the server computes them', () => {
  assert.ok(vectors.schedules.length > 500);
  for (const [n, [before, rating, now, zone, expected, shown]] of (
    vectors.schedules as [CardRow, Rating, number, string, CardRow, number[]][]
  ).entries()) {
    const got = review(card(before), rating, now, zone);
    const want = card(expected)!;
    const where = `case ${n} (${zone}, rating ${rating})`;
    assert.equal(got.state, want.state, `${where}: state`);
    assert.equal(got.step, want.step, `${where}: step`);
    assert.equal(got.dueAt, want.dueAt, `${where}: due`);
    assert.equal(got.lastReviewedAt, want.lastReviewedAt, `${where}: last review`);
    close(got.stability, want.stability, `${where}: stability`);
    close(got.difficulty, want.difficulty, `${where}: difficulty`);
    assert.deepEqual(
      previews(card(before), now, zone).map((preview) => preview.seconds),
      shown,
      `${where}: previews`,
    );
  }
});

test('days: study day from 4 AM, calendar day from midnight, across clock changes', () => {
  for (const [moment, zone, day, calendar, start, from, to] of vectors.days as [
    number,
    string,
    string,
    string,
    number,
    number,
    number,
  ][]) {
    const where = `${new Date(moment).toISOString()} in ${zone}`;
    assert.equal(studyDay(moment, zone), day, `${where}: study day`);
    assert.equal(localDate(moment, zone), calendar, `${where}: calendar day`);
    assert.equal(dayStart(day, zone), start, `${where}: day start`);
    assert.deepEqual(localDayBounds(calendar, zone), [from, to], `${where}: day bounds`);
  }
});

type StepRow = [string, string, boolean];
const steps = (rows: StepRow[]): Step[] =>
  rows.map(([id, wordId, isNew]) => ({ id, type: 'card', wordId, new: isNew }));
const rows = (plan: Step[]) => plan.map((step): StepRow => [step.id, step.wordId, step.new]);

test('the lesson queue: cards in order, a missed card shown again a few cards later', () => {
  for (const [plan, answered, word, expected] of vectors.queues as [StepRow[], number, string, StepRow[] | null][]) {
    const result = requeue(steps(plan), answered, word);
    assert.deepEqual(result && rows(result.plan), expected);
  }
  assert.deepEqual(rows(planCards(['a', 'b'], ['c'])), [
    ['c1', 'a', false],
    ['c2', 'b', false],
    ['c3', 'c', true],
  ]);
});

test("the day's pace: ramp, deadline share, extra words, the review brake", () => {
  for (const [
    target,
    enabled,
    started,
    today,
    week,
    left,
    deadline,
    share,
    newToday,
    due,
    extra,
    expected,
  ] of vectors.paces as [
    number,
    boolean,
    string | null,
    string,
    number | null,
    number,
    string | null,
    number,
    number,
    number,
    number,
    [number, number, number, boolean, boolean],
  ][]) {
    assert.equal(rampWeek(target, enabled, started, today), week);
    assert.equal(deadline ? deadlineShare(left, today, deadline) : 0, share);
    const plan = planDay(target, week, newToday, due, { deadline, share, extra });
    assert.deepEqual(
      [plan.effectiveTarget, plan.remaining, plan.nextLessonSize, plan.bonus, plan.blockedByReviews],
      expected,
    );
  }
});

type SpelledRow = [number, number, number] | null;
const spelled = (row: SpelledRow): Spelled | null => row && { rung: row[0], dueAt: row[1], lastSpelledAt: row[2] };

test('the spelling ladder, its sets, and what counts as the word', () => {
  for (const [before, right, now, zone, expected] of vectors.ladder.steps as [
    SpelledRow,
    boolean,
    number,
    string,
    SpelledRow,
  ][]) {
    assert.deepEqual(afterSpelling(spelled(before), right, now, zone), spelled(expected));
  }
  for (const [met, today, ladder, todayStart, now, mode, size, chosen, seen] of vectors.ladder.picks as [
    string[],
    string[],
    [string, number, number, number][],
    number,
    number,
    Mode,
    number,
    string[],
    number[],
  ][]) {
    const words = {
      met,
      today,
      ladder: new Map(ladder.map(([word, rung, dueAt, last]) => [word, { rung, dueAt, lastSpelledAt: last }])),
      todayStart,
    };
    assert.deepEqual(pick(mode, size, words, now, Math.random), chosen, `${mode} of ${size}`);
    const got = overview(words, now);
    assert.deepEqual([got.ready, got.due, got.today, got.todayLeft, got.hard, got.known, got.met], seen);
  }
  for (const [text, normal, bare, gaps] of vectors.ladder.words as [string, string, string, [number, string][]][]) {
    assert.equal(normalize(text), normal);
    assert.equal(letters(text), bare);
    assert.deepEqual(separators(text), gaps);
  }
});
