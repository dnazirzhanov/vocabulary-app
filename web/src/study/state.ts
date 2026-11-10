import type { Rating } from './fsrs.ts';
import { isReview, review, type CardState } from './schedule.ts';
import { afterSpelling, isCorrect, type Spelled } from './spelling.ts';

/**
 * What a device studies from (ADR 0062): the server's pack, and the answers given here since it
 * was fetched, applied on top as the server applies them (`sessions.rate_card`, `spell_word`).
 * When the next pack comes, the server's own result replaces this prediction.
 */

/** GET /api/study/pack, as sent (backend/app/schemas/study.py). */
export interface PackDeck {
  id: string;
  kind: 'course' | 'mine' | 'group';
  title: string;
  level: string | null;
  level_order: number | null;
  group_name: string | null;
  author: string | null;
  word_ids: string[];
  pace: { daily_new: number; due_on: string | null; extra_day: string | null; extra_words: number };
  /** Given to one of my groups: a course level then is open, whatever level I am on. */
  given?: boolean;
}

export interface PackWord {
  id: string;
  headword: string;
  pos: string;
  translation: string;
  example: string;
  example_translation: string;
  language: string;
  illustration: string | null;
}

type Moment = string;
/** word, FSRS state, step, stability, difficulty, due, last review, introduced, first recalled, lapses */
export type PackProgress = [
  string,
  number,
  number | null,
  number | null,
  number | null,
  Moment,
  Moment | null,
  Moment,
  Moment | null,
  number,
];
/** word, rung, due, last spelled */
export type PackSpelled = [string, number, Moment, Moment];

export interface Pack {
  time_zone: string;
  course_open: boolean;
  ramp_enabled: boolean;
  started_on: string | null;
  decks: PackDeck[];
  words: PackWord[];
  progress: PackProgress[];
  ladder: PackSpelled[];
  introduced: { scope: string; day: string; words: number }[];
}

/** One answer given on this device, as it goes to the server (`study.answer`), and what it was. */
export interface LocalAnswer {
  opId: string;
  sessionId: string;
  sessionKind: 'study' | 'hard' | 'spelling';
  deckId: string;
  exerciseId: string;
  wordId: string;
  new: boolean;
  hint: number | null;
  /** A card's rating, or the word built (and whether it was heard first). */
  rating: Rating | null;
  answer: string | null;
  heard: boolean;
  /** Milliseconds, on the server's clock. */
  answeredAt: number;
}

export interface WordProgress extends CardState {
  introducedAt: number;
  firstRecalledAt: number | null;
  lapses: number;
}

/** An introduction (a new word's first showing) in a deck's pace: 'course' or a deck id. */
export interface Introduction {
  scope: string;
  wordId: string;
  at: number;
}

export interface Learner {
  pack: Pack;
  timeZone: string;
  decks: Map<string, PackDeck>;
  words: Map<string, PackWord>;
  progress: Map<string, WordProgress>;
  ladder: Map<string, Spelled>;
  /** Introductions on this device not yet in the pack's counts. */
  introductions: Introduction[];
}

const at = (moment: Moment) => Date.parse(moment);
const maybe = (moment: Moment | null) => (moment === null ? null : at(moment));

export function fromPack(pack: Pack): Learner {
  return {
    pack,
    timeZone: pack.time_zone,
    decks: new Map(pack.decks.map((deck) => [deck.id, deck])),
    words: new Map(pack.words.map((word) => [word.id, word])),
    progress: new Map(
      pack.progress.map(([wordId, state, step, stability, difficulty, due, last, introduced, recalled, lapses]) => [
        wordId,
        {
          state,
          step,
          stability,
          difficulty,
          dueAt: at(due),
          lastReviewedAt: maybe(last),
          introducedAt: at(introduced),
          firstRecalledAt: maybe(recalled),
          lapses,
        },
      ]),
    ),
    ladder: new Map(
      pack.ladder.map(([wordId, rung, due, last]) => [wordId, { rung, dueAt: at(due), lastSpelledAt: at(last) }]),
    ),
    introductions: [],
  };
}

/** The pace a deck's new words count in: the course's levels share one (`pace.day_plan`). */
export const scopeOf = (deck: PackDeck | undefined, deckId: string) => (deck?.kind === 'course' ? 'course' : deckId);

/**
 * Applies one answer as the server will (`rate_card` / `spell_word`), given the answers earlier
 * in the same lesson. Returns what the lesson needs to know: whether it was a review, and the
 * card's state after.
 */
export function applyAnswer(
  learner: Learner,
  answer: LocalAnswer,
  earlier: readonly LocalAnswer[],
): { wasReview: boolean; after: WordProgress | null; correct: boolean | null } {
  const now = answer.answeredAt;
  if (answer.rating === null) {
    const headword = learner.words.get(answer.wordId)?.headword ?? '';
    const correct = isCorrect(answer.answer ?? '', headword);
    const right = correct && answer.hint === null && !answer.heard;
    const before = learner.ladder.get(answer.wordId) ?? null;
    // A word no lesson has shown («Все слова») is practice: off the ladder, so it never reaches
    // the main button (ADR 0064). One a group's test put there stays on it.
    if (!learner.progress.has(answer.wordId) && before === null) {
      return { wasReview: false, after: null, correct };
    }
    // A try earlier than one already recorded counts as of that one (ADR 0062).
    const moment = before ? Math.max(now, before.lastSpelledAt) : now;
    learner.ladder.set(answer.wordId, afterSpelling(before, right, moment, learner.timeZone));
    return { wasReview: false, after: learner.progress.get(answer.wordId) ?? null, correct };
  }
  const before = learner.progress.get(answer.wordId) ?? null;
  const repeat = earlier.some((other) => other.wordId === answer.wordId && other.rating !== null);
  const wasReview = before !== null && isReview(before) && !repeat;
  const recalled = wasReview && answer.rating >= 2 && before !== null && before.firstRecalledAt === null;
  if (answer.sessionKind === 'hard' && before) {
    // Practice leaves the schedule alone, but a recall still counts as one.
    const kept = recalled ? { ...before, firstRecalledAt: now } : before;
    learner.progress.set(answer.wordId, kept);
    return { wasReview, after: kept, correct: null };
  }
  const scheduledAt = before?.lastReviewedAt ? Math.max(now, before.lastReviewedAt) : now;
  const card = review(before, answer.rating, scheduledAt, learner.timeZone);
  const after: WordProgress = before
    ? {
        ...card,
        introducedAt: before.introducedAt,
        firstRecalledAt: recalled ? now : before.firstRecalledAt,
        lapses: before.lapses + (answer.rating === 1 && before.state !== 1 ? 1 : 0),
      }
    : { ...card, introducedAt: now, firstRecalledAt: null, lapses: 0 };
  learner.progress.set(answer.wordId, after);
  // Points (and so an introduction) only for a new card's first showing (`card_points`).
  if (before === null && answer.new) {
    learner.introductions.push({
      scope: scopeOf(learner.decks.get(answer.deckId), answer.deckId),
      wordId: answer.wordId,
      at: now,
    });
  }
  return { wasReview, after, correct: null };
}

/**
 * The pack, with every answer given here since applied in order. `lessonAnswers` gives a lesson's
 * whole list (some may be in the pack already), to tell a card shown again from its first showing.
 */
export function learnerFrom(
  pack: Pack,
  answers: readonly LocalAnswer[],
  lessonAnswers: (sessionId: string) => readonly LocalAnswer[] = () => [],
): Learner {
  const learner = fromPack(pack);
  answers.forEach((answer, index) => {
    const all = lessonAnswers(answer.sessionId);
    const known = all.findIndex((other) => other.opId === answer.opId);
    // Without the lesson's record, its answers here are all there is.
    const earlier =
      known === -1
        ? answers.slice(0, index).filter((other) => other.sessionId === answer.sessionId)
        : all.slice(0, known);
    applyAnswer(learner, answer, earlier);
  });
  return learner;
}
