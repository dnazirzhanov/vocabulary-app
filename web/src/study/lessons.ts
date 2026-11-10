import { ApiError } from '../lib/apiError.ts';
import type {
  AttemptResult,
  CardExercise,
  DeckStats,
  Exercise,
  Hint,
  Rating,
  Session,
  SessionKind,
  SpellingExercise,
  SpellingState,
  Summary,
  Word,
} from '../lib/types.ts';
import {
  deadlineShare,
  HARD_CARDS_PER_SESSION,
  pickNewWords,
  planCards,
  planDay,
  rampWeek,
  REQUEUE_WITHIN_SECONDS,
  requeue,
  REVIEW_CARDS_PER_SESSION,
  type DayPlan,
  type Step,
} from './plan.ts';
import { REVIEW } from './fsrs.ts';
import { isWellLearned, previews } from './schedule.ts';
import { letters, overview, pick, separators, tiles, type Mode, type Words } from './spelling.ts';
import { applyAnswer, scopeOf, type Learner, type LocalAnswer } from './state.ts';
import { localDate, localDayBounds } from './time.ts';

/**
 * Lessons on the device (ADR 0062): planned, shown, answered and summed up here, as the server's
 * `services/sessions.py` does, in the shapes the screens already take from it.
 */

/** A lesson as this device keeps it. */
export interface LocalLesson {
  id: string;
  kind: SessionKind;
  deckId: string;
  steps: Step[];
  results: AttemptResult[];
  /** Its answers, in order, as sent. */
  answers: LocalAnswer[];
  /** Words whose card was a review here (`was_review`): a first showing of a word being reviewed. */
  reviewed: string[];
  startedAt: number;
  finishedAt: number | null;
  setAsideAt: number | null;
}

export const isOpen = (lesson: LocalLesson) => lesson.finishedAt === null && lesson.setAsideAt === null;

const refuse = (status: number, code: string) => new ApiError('http', status, code, code);

function deckOf(learner: Learner, deckId: string) {
  const deck = learner.decks.get(deckId);
  if (!deck) throw refuse(404, 'deck_not_found');
  return deck;
}

// --- the day ----------------------------------------------------------------------------------

/** The course's levels in order, and the one the learner is on (the first with words to meet). */
function course(learner: Learner) {
  const levels = [...learner.decks.values()]
    .filter((deck) => deck.kind === 'course')
    .sort((a, b) => (a.level_order ?? 0) - (b.level_order ?? 0) || (a.id < b.id ? -1 : 1));
  const index = levels.findIndex((deck) => metIn(learner, deck.word_ids) < deck.word_ids.length);
  return { levels, current: index === -1 ? Math.max(0, levels.length - 1) : index };
}

const metIn = (learner: Learner, wordIds: readonly string[]) =>
  wordIds.filter((wordId) => learner.progress.has(wordId)).length;

export function isLocked(learner: Learner, deckId: string): boolean {
  const { levels, current } = course(learner);
  const index = levels.findIndex((deck) => deck.id === deckId);
  return index > current;
}

const dueCount = (learner: Learner, now: number) =>
  [...learner.progress.values()].filter((card) => card.dueAt <= now).length;

/** Today in one deck (`pace.day_plan`): new words met in its pace today, against its pace. */
export function dayPlan(learner: Learner, deckId: string, now: number): DayPlan {
  const deck = deckOf(learner, deckId);
  const zone = learner.timeZone;
  const today = localDate(now, zone);
  const scope = scopeOf(deck, deckId);
  const [start, end] = localDayBounds(today, zone);
  const counted = learner.pack.introduced.find((row) => row.scope === scope && row.day === today)?.words ?? 0;
  const here = learner.introductions.filter((row) => row.scope === scope && row.at >= start && row.at < end).length;
  const newToday = counted + here;
  const target = deck.pace.daily_new;
  const week =
    deck.kind === 'course' ? rampWeek(target, learner.pack.ramp_enabled, learner.pack.started_on, today) : null;
  const deadline = deck.pace.due_on;
  const left = deck.word_ids.length - metIn(learner, deck.word_ids);
  return planDay(target, week, newToday, dueCount(learner, now), {
    deadline,
    share: deadline ? deadlineShare(left + newToday, today, deadline) : 0,
    extra: deck.pace.extra_day === today ? deck.pace.extra_words : 0,
  });
}

const allowance = (plan: DayPlan) => (plan.blockedByReviews ? 0 : plan.remaining);

/**
 * Cards this device has in the deck that the study pack doesn't (added here and not yet on the
 * server, or the pack is older than them): they can't be in a lesson until the pack has them.
 */
export function missingFromPack(learner: Learner, deckId: string, localCardIds: readonly string[]): string[] {
  const known = new Set(learner.decks.get(deckId)?.word_ids ?? []);
  return localCardIds.filter((id) => !known.has(id));
}

/**
 * Whether any word of the deck was met after `moment`: a spelling left before that isn't resumed
 * by the main button, which starts afresh with the new words first (ADR 0064).
 */
export function metSince(learner: Learner, deckId: string, moment: number): boolean {
  const words = learner.decks.get(deckId)?.word_ids ?? [];
  return words.some((wordId) => (learner.progress.get(wordId)?.introducedAt ?? -Infinity) > moment);
}

// --- what a lesson takes ----------------------------------------------------------------------

/** One deck's due cards, most overdue first, then its new words as today's pace allows. */
export function planStudy(learner: Learner, deckId: string, now: number): Step[] {
  const deck = deckOf(learner, deckId);
  if (isLocked(learner, deckId)) throw refuse(409, 'deck_locked');
  const due = deck.word_ids
    .filter((wordId) => (learner.progress.get(wordId)?.dueAt ?? Infinity) <= now)
    .sort((a, b) => learner.progress.get(a)!.dueAt - learner.progress.get(b)!.dueAt || (a < b ? -1 : 1))
    .slice(0, REVIEW_CARDS_PER_SESSION);
  const today = dayPlan(learner, deckId, now);
  const fresh = today.blockedByReviews
    ? []
    : pickNewWords(deck.word_ids, new Set(learner.progress.keys()), today.nextLessonSize);
  if (due.length === 0 && fresh.length === 0) {
    throw refuse(409, today.blockedByReviews ? 'reviews_first' : 'nothing_to_study');
  }
  return planCards(due, fresh);
}

/** The deck's hardest words: highest difficulty, then most lapses, then deck order. */
export function planHard(learner: Learner, deckId: string): Step[] {
  const deck = deckOf(learner, deckId);
  const position = new Map(deck.word_ids.map((wordId, index) => [wordId, index]));
  const hardest = deck.word_ids
    .filter((wordId) => learner.progress.has(wordId))
    .sort((a, b) => {
      const [x, y] = [learner.progress.get(a)!, learner.progress.get(b)!];
      const difficulty = (y.difficulty ?? -Infinity) - (x.difficulty ?? -Infinity);
      return difficulty || y.lapses - x.lapses || position.get(a)! - position.get(b)!;
    })
    .slice(0, HARD_CARDS_PER_SESSION);
  if (hardest.length === 0) throw refuse(409, 'nothing_to_practice');
  return planCards(hardest, []);
}

/** What the learner can spell from in one deck (`spelling_ladder.load`). */
export function spellingWords(learner: Learner, deckId: string, now: number): Words {
  const deck = deckOf(learner, deckId);
  const [start, end] = localDayBounds(localDate(now, learner.timeZone), learner.timeZone);
  const met = deck.word_ids
    .filter((wordId) => learner.progress.has(wordId))
    .sort((a, b) => learner.progress.get(a)!.introducedAt - learner.progress.get(b)!.introducedAt || (a < b ? -1 : 1));
  const today = met.filter((wordId) => {
    const introduced = learner.progress.get(wordId)!.introducedAt;
    return introduced >= start && introduced < end;
  });
  const inDeck = new Set(deck.word_ids);
  const ladder = new Map([...learner.ladder].filter(([wordId]) => inDeck.has(wordId)));
  return { met, today, ladder, todayStart: start, deck: deck.word_ids };
}

export function planSpelling(
  learner: Learner,
  deckId: string,
  mode: Mode,
  size: number,
  now: number,
  random: () => number,
): Step[] {
  const chosen = pick(mode, size, spellingWords(learner, deckId, now), now, random);
  if (chosen.length === 0) throw refuse(409, 'nothing_to_spell');
  return chosen.map((wordId, n) => ({
    id: `s${n + 1}`,
    type: 'spelling',
    wordId,
    new: false,
    tiles: tiles(learner.words.get(wordId)!.headword, random),
    hint: null,
  }));
}

// --- showing it -------------------------------------------------------------------------------

function wordOut(learner: Learner, wordId: string): Word {
  const word = learner.words.get(wordId)!;
  return { ...word, language: word.language as Word['language'] };
}

function exerciseOut(learner: Learner, step: Step, now: number): Exercise {
  const word = learner.words.get(step.wordId)!;
  if (step.type === 'spelling') {
    const hint = step.hint ?? null;
    return {
      id: step.id,
      type: 'spelling',
      prompt: { translation: word.translation, pos: word.pos },
      slots: letters(word.headword).length,
      separators: separators(word.headword).map(([after, char]) => ({ after, char })),
      tiles: step.tiles ?? [],
      hint: hint === null ? null : { position: hint, letter: letters(word.headword)[hint] },
      pronunciation: { key: word.id, text: word.headword },
    } satisfies SpellingExercise;
  }
  return {
    id: step.id,
    type: 'card',
    word: wordOut(learner, step.wordId),
    new: step.new,
    previews: previews(learner.progress.get(step.wordId) ?? null, now, learner.timeZone),
  } satisfies CardExercise;
}

export function present(learner: Learner, lesson: LocalLesson, now: number): Session {
  return {
    id: lesson.id,
    kind: lesson.kind,
    deck_id: lesson.deckId,
    completed: lesson.finishedAt !== null,
    exercises: lesson.steps.map((step) => exerciseOut(learner, step, now)),
    results: lesson.results,
  };
}

// --- answering --------------------------------------------------------------------------------

export type Response = { kind: 'rating'; rating: Rating } | { kind: 'spelling'; answer: string; heard: boolean };

/**
 * One answer, in order, as `submit_attempt` takes it: the learner's state moves, the lesson keeps
 * its result, and a forgotten card comes back a few cards later. Returns the lesson after it, the
 * answer to send, and the result to show. `null` result: already answered (a double tap).
 */
export function answer(
  learner: Learner,
  lesson: LocalLesson,
  exerciseId: string,
  response: Response,
  now: number,
  opId: string,
): { lesson: LocalLesson; sent: LocalAnswer; result: AttemptResult } | { result: AttemptResult } {
  const done = lesson.results.find((result) => result.exercise_id === exerciseId);
  if (done) return { result: done };
  if (!isOpen(lesson)) throw refuse(409, 'session_completed');
  const index = lesson.steps.findIndex((step) => step.id === exerciseId);
  if (index === -1) throw refuse(404, 'exercise_not_found');
  if (index !== lesson.results.length) throw refuse(409, 'out_of_order');
  const step = lesson.steps[index];
  if ((step.type === 'spelling') !== (response.kind === 'spelling')) throw refuse(422, 'wrong_response');
  const sent: LocalAnswer = {
    opId,
    sessionId: lesson.id,
    sessionKind: lesson.kind,
    deckId: lesson.deckId,
    exerciseId,
    wordId: step.wordId,
    new: step.new,
    hint: step.hint ?? null,
    rating: response.kind === 'rating' ? response.rating : null,
    answer: response.kind === 'spelling' ? response.answer : null,
    heard: response.kind === 'spelling' ? response.heard : false,
    answeredAt: now,
  };
  const applied = applyAnswer(learner, sent, lesson.answers);
  let steps = lesson.steps;
  const inserted: AttemptResult['inserted'] = [];
  let result: AttemptResult;
  if (response.kind === 'spelling') {
    result = {
      exercise_id: exerciseId,
      rating: null,
      next_due_at: null,
      correct: applied.correct,
      answer: learner.words.get(step.wordId)!.headword,
      inserted,
    };
  } else {
    const after = applied.after!;
    const practice = lesson.kind === 'hard';
    const soon = after.state !== REVIEW && after.dueAt - now <= REQUEUE_WITHIN_SECONDS * 1000;
    if (practice ? response.rating === 1 : soon) {
      const again = requeue(steps, index, step.wordId);
      if (again) {
        steps = again.plan;
        inserted.push({ index: steps.indexOf(again.again), exercise: exerciseOut(learner, again.again, now) });
      }
    }
    result = {
      exercise_id: exerciseId,
      rating: response.rating,
      next_due_at: new Date(after.dueAt).toISOString(),
      correct: null,
      answer: null,
      inserted,
    };
  }
  return {
    lesson: {
      ...lesson,
      steps,
      results: [...lesson.results, result],
      answers: [...lesson.answers, sent],
      reviewed: applied.wasReview ? [...lesson.reviewed, step.wordId] : lesson.reviewed,
    },
    sent,
    result,
  };
}

/** The one letter of a spelling card (`give_hint`): asking again for that slot gives it again. */
export function hint(
  learner: Learner,
  lesson: LocalLesson,
  exerciseId: string,
  position: number,
): { lesson: LocalLesson; hint: Hint } {
  const step = lesson.steps.find((candidate) => candidate.id === exerciseId);
  if (!step || step.type !== 'spelling') throw refuse(404, 'exercise_not_found');
  const word = letters(learner.words.get(step.wordId)!.headword);
  if (step.hint !== null && step.hint !== undefined) {
    if (step.hint !== position) throw refuse(409, 'hint_used');
    return { lesson, hint: { position, letter: word[position] } };
  }
  if (!isOpen(lesson) || lesson.results.some((result) => result.exercise_id === exerciseId)) {
    throw refuse(409, 'already_answered');
  }
  if (position < 0 || position >= word.length) throw refuse(422, 'no_such_letter');
  return {
    lesson: {
      ...lesson,
      steps: lesson.steps.map((candidate) =>
        candidate.id === exerciseId ? { ...candidate, hint: position } : candidate,
      ),
    },
    hint: { position, letter: word[position] },
  };
}

// --- summing up -------------------------------------------------------------------------------

export function spellingState(
  learner: Learner,
  deckId: string,
  now: number,
  paused: LocalLesson | null,
): SpellingState {
  const seen = overview(spellingWords(learner, deckId, now), now);
  const spelled = paused?.results ?? [];
  return {
    ready: seen.ready,
    due: seen.due,
    today: seen.today,
    today_left: seen.todayLeft,
    hard: seen.hard,
    known: seen.known,
    met: seen.met,
    words: seen.words,
    paused: paused && {
      spelled: spelled.length,
      right: spelled.filter((result) => result.correct).length,
      total: paused.steps.length,
    },
  };
}

/** The finish screen (`complete_session`). */
export function summarize(learner: Learner, lesson: LocalLesson, now: number, paused: LocalLesson | null): Summary {
  const cards = lesson.steps.filter((step) => step.type === 'card');
  const byId = new Map(lesson.results.map((result) => [result.exercise_id, result]));
  const rated = cards.map((step) => ({ step, result: byId.get(step.id)! }));
  const wordIds = [...new Set(cards.map((step) => step.wordId))];
  const ratingOf = (result: AttemptResult) => result.rating ?? 0;
  const counts = [1, 2, 3, 4].map((rating) => rated.filter(({ result }) => result.rating === rating).length);
  return {
    session_id: lesson.id,
    kind: lesson.kind,
    deck_id: lesson.deckId,
    words: wordIds.map((wordId) => {
      const mine = rated.filter(({ step }) => step.wordId === wordId).map(({ result }) => ratingOf(result));
      return {
        word: wordOut(learner, wordId),
        rating: mine[mine.length - 1] as Rating,
        lowest_rating: Math.min(...mine.map((rating) => rating || 4)) as Rating,
        showings: mine.length,
        next_review_at: new Date(learner.progress.get(wordId)!.dueAt).toISOString(),
      };
    }),
    new_words: cards.filter((step) => step.new).length,
    reviewed_words: new Set(lesson.reviewed).size,
    ratings: { again: counts[0], hard: counts[1], good: counts[2], easy: counts[3] },
    spelling_today: learner.decks.has(lesson.deckId) ? spellingState(learner, lesson.deckId, now, paused) : null,
    spelling: spellingSummary(lesson),
  };
}

function spellingSummary(lesson: LocalLesson): Summary['spelling'] {
  const spelled = lesson.results.filter((result) => result.rating === null);
  if (spelled.length === 0) return null;
  const right = spelled.filter((result) => result.correct).length;
  return { words: spelled.length, first_try: right, needs_practice: spelled.length - right };
}

/** A deck's page (`deck_stats`). */
export function deckStats(learner: Learner, deckId: string, now: number, paused: LocalLesson | null): DeckStats {
  const deck = deckOf(learner, deckId);
  const mine = deck.word_ids.map((wordId) => learner.progress.get(wordId)).filter((card) => card !== undefined);
  const due = mine.filter((card) => card.dueAt <= now);
  const learning = due.filter((card) => card.state !== REVIEW).length;
  const upcoming = mine.filter((card) => card.dueAt > now).map((card) => card.dueAt);
  const locked = deck.kind === 'course' && isLocked(learner, deckId);
  const left = deck.word_ids.length - mine.length;
  return {
    id: deck.id,
    title: deck.title,
    kind: deck.kind === 'course' ? 'course' : 'user',
    level: deck.level,
    is_mine: deck.kind === 'mine',
    author: deck.author,
    group_name: deck.group_name,
    word_count: deck.word_ids.length,
    introduced_count: mine.length,
    learning_count: learning,
    review_count: due.length - learning,
    well_learned: mine.filter((card) => isWellLearned(card.state, card.stability)).length,
    learned: mine.filter((card) => card.firstRecalledAt !== null).length,
    new_today: locked ? 0 : Math.min(allowance(dayPlan(learner, deckId, now)), left),
    next_due_at: upcoming.length ? new Date(Math.min(...upcoming)).toISOString() : null,
    locked,
    spelling_today: spellingState(learner, deckId, now, paused),
  };
}
