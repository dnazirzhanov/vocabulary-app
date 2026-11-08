import { REVIEW, RELEARNING, reviewCard, roundHalfEven, type FsrsCard, type Rating } from './fsrs.ts';
import { addDays, dayStart, daysBetween, studyDay } from './time.ts';

/**
 * A word's schedule, as `review` in backend/app/services/scheduling.py makes it: FSRS, plus what
 * Anki does around it (ADR 0025).
 * - Time since the last review counts in the learner's study days (from 4 AM), not 24-hour periods.
 * - A card going to review in days waits at least a day longer for each better answer.
 * - A review is due from the start of its day; learning steps stay exact minutes.
 */

export const RATINGS: Rating[] = [1, 2, 3, 4];
export const WELL_LEARNED_STABILITY_DAYS = 21.0;
const DAY = 86_400_000;

/** A word's schedule as stored (user_word_progress); moments in milliseconds. */
export interface CardState {
  state: number;
  step: number | null;
  stability: number | null;
  difficulty: number | null;
  dueAt: number;
  lastReviewedAt: number | null;
}

export const isReview = (card: CardState) => card.state === REVIEW || card.state === RELEARNING;

function toFsrs(card: CardState | null, now: number): FsrsCard {
  if (card === null) return { state: 1, step: 0, stability: null, difficulty: null, due: now, lastReview: null };
  return {
    state: card.state,
    step: card.step,
    stability: card.stability,
    difficulty: card.difficulty,
    due: card.dueAt,
    lastReview: card.lastReviewedAt,
  };
}

function libraryReview(card: CardState | null, rating: Rating, now: number, timeZone: string): CardState {
  const fsrs = toFsrs(card, now);
  if (card !== null && card.lastReviewedAt !== null) {
    // Exactly as many 24-hour periods ago as there are study days in between.
    const days = daysBetween(studyDay(card.lastReviewedAt, timeZone), studyDay(now, timeZone));
    fsrs.lastReview = now - Math.max(days, 0) * DAY;
  }
  const after = reviewCard(fsrs, rating, now);
  return {
    state: after.state,
    step: after.step,
    stability: after.stability,
    difficulty: after.difficulty,
    dueAt: after.due,
    lastReviewedAt: now,
  };
}

const inDays = (after: CardState, now: number) =>
  after.state === REVIEW ? roundHalfEven((after.dueAt - now) / DAY) : null;

/** The schedule after rating a card at `now`; `card` is null for a new word. */
export function review(card: CardState | null, rating: Rating, now: number, timeZone: string): CardState {
  const after = libraryReview(card, rating, now, timeZone);
  let days = inDays(after, now);
  if (days === null) return after;
  for (let lower = rating - 1; lower > 1; lower -= 1) {
    const below = inDays(libraryReview(card, lower as Rating, now, timeZone), now);
    if (below === null) break;
    days = Math.max(days, below + rating - lower);
  }
  return { ...after, dueAt: dayStart(addDays(studyDay(now, timeZone), days), timeZone) };
}

/** How long until the card returns for each rating: minutes for a step, whole days for a review. */
export function previews(card: CardState | null, now: number, timeZone: string): { rating: Rating; seconds: number }[] {
  return RATINGS.map((rating) => {
    const after = review(card, rating, now, timeZone);
    const ms =
      after.state === REVIEW
        ? daysBetween(studyDay(now, timeZone), studyDay(after.dueAt, timeZone)) * DAY
        : after.dueAt - now;
    return { rating, seconds: roundHalfEven(ms / 1000) };
  });
}

export const isWellLearned = (state: number, stability: number | null) =>
  state === REVIEW && (stability ?? 0) >= WELL_LEARNED_STABILITY_DAYS;
