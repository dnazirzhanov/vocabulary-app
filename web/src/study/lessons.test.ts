import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../lib/apiError.ts';
import {
  answer,
  dayPlan,
  deckStats,
  hint,
  metSince,
  missingFromPack,
  planSpelling,
  planStudy,
  summarize,
  withExtra,
  type LocalLesson,
} from './lessons.ts';
import { learnerFrom, type Pack, type PackDeck } from './state.ts';

// Lessons on the device (ADR 0062), as `services/sessions.py` plans, answers and sums them up.

const ZONE = 'Asia/Bishkek';
const NOW = Date.parse('2026-11-08T06:00:00Z'); // noon in Bishkek
const DAY = 86_400_000;

const level = (id: string, order: number, words: string[]): PackDeck => ({
  id,
  kind: 'course',
  title: id,
  level: id,
  level_order: order,
  group_name: null,
  author: null,
  word_ids: words,
  pace: { daily_new: 3, due_on: null, extra_day: null, extra_words: 0 },
});

const wordsOf = (ids: string[]) =>
  ids.map((id) => ({
    id,
    headword: id,
    pos: 'noun',
    translation: `перевод ${id}`,
    example: `A ${id}.`,
    example_translation: '',
    language: 'ru',
    illustration: null,
  }));

function packWith(progress: Pack['progress'] = []): Pack {
  const first = ['a', 'b', 'c', 'd', 'e', 'f'];
  const second = ['g', 'h'];
  return {
    time_zone: ZONE,
    course_open: true,
    ramp_enabled: false,
    started_on: null,
    decks: [level('one', 1, first), level('two', 2, second)],
    words: wordsOf([...first, ...second]),
    progress,
    ladder: [],
    introduced: [],
  };
}

const iso = (moment: number) => new Date(moment).toISOString();
// A word in review, due `days` from now (negative: overdue).
const reviewing = (id: string, days: number): Pack['progress'][number] => [
  id,
  2,
  null,
  10,
  5,
  iso(NOW + days * DAY),
  iso(NOW - 10 * DAY),
  iso(NOW - 20 * DAY),
  null,
  0,
];

const lessonOf = (steps: ReturnType<typeof planStudy>, kind: LocalLesson['kind'] = 'study'): LocalLesson => ({
  id: 'lesson-1',
  kind,
  deckId: 'one',
  steps,
  results: [],
  answers: [],
  reviewed: [],
  startedAt: NOW,
  finishedAt: null,
  setAsideAt: null,
});

const refused = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;

test("a lesson: due cards first, most overdue first, then new words up to today's pace", () => {
  const learner = learnerFrom(packWith([reviewing('c', -1), reviewing('a', -3), reviewing('b', 2)]), []);
  const steps = planStudy(learner, 'one', NOW);
  assert.deepEqual(
    steps.map((step) => [step.id, step.wordId, step.new]),
    [
      ['c1', 'a', false],
      ['c2', 'c', false],
      ['c3', 'd', true],
      ['c4', 'e', true],
      ['c5', 'f', true],
    ],
  );
  assert.equal(dayPlan(learner, 'one', NOW).remaining, 3);
});

test('a later level is locked until the one before is met', () => {
  const learner = learnerFrom(packWith(), []);
  assert.throws(() => planStudy(learner, 'two', NOW), refused('deck_locked'));
  assert.equal(deckStats(learner, 'two', NOW, null).locked, true);
  assert.equal(deckStats(learner, 'one', NOW, null).new_today, 3);
});

test("a forgotten card comes back three cards later; the day's new words are then counted", () => {
  const learner = learnerFrom(packWith(), []);
  let lesson = lessonOf(planStudy(learner, 'one', NOW));
  const first = answer(learner, lesson, 'c1', { kind: 'rating', rating: 1 }, NOW, 'op-1');
  assert.ok('sent' in first);
  assert.deepEqual(
    first.result.inserted.map(({ index, exercise }) => [index, exercise.id]),
    [[3, 'c4']],
  );
  lesson = first.lesson;
  assert.deepEqual(
    lesson.steps.map((step) => step.wordId),
    ['a', 'b', 'c', 'a'],
  );
  // The same tap again: the first answer stands, nothing is sent twice.
  const again = answer(learner, lesson, 'c1', { kind: 'rating', rating: 4 }, NOW + 1000, 'op-2');
  assert.ok(!('sent' in again));
  assert.equal(again.result.rating, 1);
  assert.throws(
    () => answer(learner, lesson, 'c3', { kind: 'rating', rating: 3 }, NOW, 'op-3'),
    refused('out_of_order'),
  );
  // Introduced today: the pace counts it at once.
  assert.equal(dayPlan(learner, 'one', NOW).newToday, 1);
});

test("the finish screen's numbers, as the server sums them up", () => {
  const learner = learnerFrom(packWith([reviewing('a', -1)]), []);
  let lesson = lessonOf(planStudy(learner, 'one', NOW));
  const ratings: Record<string, 1 | 2 | 3 | 4> = { a: 3, b: 4, c: 1, d: 3 };
  let moment = NOW;
  for (let index = 0; index < lesson.steps.length; index += 1) {
    const step = lesson.steps[index];
    moment += 10_000;
    const seen = lesson.steps.slice(0, index).some((earlier) => earlier.wordId === step.wordId);
    const done = answer(
      learner,
      lesson,
      step.id,
      { kind: 'rating', rating: seen ? 3 : ratings[step.wordId] },
      moment,
      `op-${index}`,
    );
    assert.ok('sent' in done);
    lesson = done.lesson;
  }
  lesson = { ...lesson, finishedAt: moment };
  const summary = summarize(learner, lesson, moment, null);
  assert.equal(summary.new_words, 3);
  assert.equal(summary.reviewed_words, 1);
  // A new word rated «Хорошо» is on a ten-minute step, so it comes back once more; «Снова» twice.
  assert.deepEqual(
    lesson.steps.map((step) => step.wordId),
    ['a', 'b', 'c', 'd', 'c', 'd', 'c'],
  );
  assert.deepEqual(summary.ratings, { again: 1, hard: 0, good: 5, easy: 1 });
  const c = summary.words.find((word) => word.word.id === 'c')!;
  assert.deepEqual([c.rating, c.lowest_rating, c.showings], [3, 1, 3]);
});

test('one hint per spelling card, and none once it is answered', () => {
  const learner = learnerFrom(packWith([reviewing('a', 5)]), []);
  const lesson = lessonOf(
    [{ id: 's1', type: 'spelling', wordId: 'a', new: false, tiles: ['a', 'x'], hint: null }],
    'spelling',
  );
  const given = hint(learner, lesson, 's1', 0);
  assert.deepEqual(given.hint, { position: 0, letter: 'a' });
  assert.deepEqual(hint(learner, given.lesson, 's1', 0).hint, { position: 0, letter: 'a' });
  assert.throws(() => hint(learner, given.lesson, 's1', 1), refused('hint_used'));
  // A hinted word is a miss on the ladder, even built right.
  const done = answer(learner, given.lesson, 's1', { kind: 'spelling', answer: 'a', heard: false }, NOW, 'op-s');
  assert.ok('sent' in done);
  assert.equal(done.result.correct, true);
  assert.equal(learner.ladder.get('a')?.rung, 0);
});

test('answers replayed on a newer pack give the same learner as answering live', () => {
  const pack = packWith([reviewing('a', -1)]);
  const live = learnerFrom(pack, []);
  let lesson = lessonOf(planStudy(live, 'one', NOW));
  for (const [index, step] of lesson.steps.entries()) {
    const done = answer(live, lesson, step.id, { kind: 'rating', rating: 2 }, NOW + index * 7000, `op-${index}`);
    assert.ok('sent' in done);
    lesson = done.lesson;
  }
  const replayed = learnerFrom(pack, lesson.answers, () => lesson.answers);
  assert.deepEqual(replayed.progress, live.progress);
  assert.deepEqual(replayed.introductions, live.introductions);
});

test('an answer earlier than one already applied is scheduled from the later one', () => {
  const learner = learnerFrom(packWith([reviewing('a', -1)]), []);
  const lastReview = Date.parse(learner.pack.progress[0][6]!);
  const lesson = lessonOf([{ id: 'c1', type: 'card', wordId: 'a', new: false }]);
  const done = answer(learner, lesson, 'c1', { kind: 'rating', rating: 3 }, lastReview - DAY, 'op-late');
  assert.ok('sent' in done);
  assert.equal(learner.progress.get('a')!.lastReviewedAt, lastReview);
  assert.equal(done.sent.answeredAt, lastReview - DAY);
});

test('«Все слова»: the whole deck in its order, and a word no lesson has shown is practice (ADR 0064)', () => {
  const learner = learnerFrom(packWith([reviewing('a', 5), reviewing('b', 5)]), []);
  const steps = planSpelling(learner, 'one', 'all', 10, NOW, () => 0.5);
  assert.deepEqual(
    steps.map((step) => step.wordId),
    ['a', 'b', 'c', 'd', 'e', 'f'],
  );
  let lesson = lessonOf(steps, 'spelling');
  // Missed: a met word goes on the ladder as hard; c, never shown in a lesson, stays off it.
  for (const [index, wordId] of ['a', 'b', 'c'].entries()) {
    const done = answer(
      learner,
      lesson,
      `s${index + 1}`,
      { kind: 'spelling', answer: 'zz', heard: false },
      NOW,
      `op-${wordId}`,
    );
    assert.ok('sent' in done);
    assert.equal(done.result.correct, false);
    lesson = done.lesson;
  }
  assert.equal(learner.ladder.get('a')?.rung, 0);
  assert.equal(learner.ladder.get('c'), undefined);
  assert.equal(learner.progress.has('c'), false); // not introduced either
});

test('a spelling left before new words were met is not resumed (ADR 0064)', () => {
  const learner = learnerFrom(packWith([reviewing('a', 5)]), []);
  const introduced = Date.parse(learner.pack.progress[0][7]);
  assert.equal(metSince(learner, 'one', introduced - 1), true);
  assert.equal(metSince(learner, 'one', introduced), false);
  assert.equal(metSince(learner, 'two', introduced - 1), false); // another deck's words
});

test("the deck's cards on this device that the study pack doesn't have yet", () => {
  const learner = learnerFrom(packWith(), []);
  // One: a, b and c are in the pack; t-new was added here; a deck the pack lacks has all missing.
  assert.deepEqual(missingFromPack(learner, 'one', ['a', 'b', 't-new', 'c']), ['t-new']);
  assert.deepEqual(missingFromPack(learner, 'one', ['a', 'b']), []);
  assert.deepEqual(missingFromPack(learner, 'mine', ['t-1', 't-2']), ['t-1', 't-2']);
});

test('«Ещё N слов» on the device adds to the day, as the server will (pace.extend)', () => {
  const extra = (pack: Pack) => pack.decks.find((deck) => deck.id === 'one')!.pace;
  const monday = withExtra(packWith(), 'one', 4, '2026-11-09');
  assert.deepEqual([extra(monday).extra_day, extra(monday).extra_words], ['2026-11-09', 4]);
  // Again the same day: added; at most 200.
  assert.equal(extra(withExtra(monday, 'one', 3, '2026-11-09')).extra_words, 7);
  assert.equal(
    extra(withExtra(withExtra(monday, 'one', 100, '2026-11-09'), 'one', 100, '2026-11-09')).extra_words,
    200,
  );
  // A later day starts again; an earlier one changes nothing.
  assert.equal(extra(withExtra(monday, 'one', 2, '2026-11-10')).extra_words, 2);
  assert.deepEqual(withExtra(monday, 'one', 9, '2026-11-08'), monday);
  // Other decks untouched.
  assert.deepEqual(
    monday.decks.filter((deck) => deck.id !== 'one'),
    packWith().decks.filter((deck) => deck.id !== 'one'),
  );
});
