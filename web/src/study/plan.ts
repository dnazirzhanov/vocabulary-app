/**
 * What a lesson holds and how much a day asks, as the server decides it
 * (backend/app/services/learning.py, pace.py). Pure: the device plans its own lessons with these
 * (ADR 0062), and web/src/study/vectors.json keeps them equal to the server's.
 */

export const REVIEW_CARDS_PER_SESSION = 30;
export const HARD_CARDS_PER_SESSION = 10;
export const REQUEUE_WITHIN_SECONDS = 20 * 60;
export const MAX_SHOWINGS_PER_SESSION = 4;
export const REQUEUE_GAP = 3;

const MAX_LESSON_WORDS = 10;
const BONUS_LESSON_WORDS = 5;
const RAMP_MIN_TARGET = 10;
const RAMP_SHARES = [0.5, 0.75];
const REVIEWS_PER_WORD = 5;
const DEBT_FLOOR = 20;

/** One step of a lesson: a card to rate or a word to spell. */
export interface Step {
  id: string;
  type: 'card' | 'spelling';
  wordId: string;
  /** A word met for the first time in this lesson. */
  new: boolean;
  /** Spelling: the letter tiles, in display order. */
  tiles?: string[];
  /** Spelling: the slot whose letter was given as a hint. */
  hint?: number | null;
}

/** The next words of the deck not met yet, in deck order. */
export function pickNewWords(deckOrder: readonly string[], introduced: ReadonlySet<string>, limit: number): string[] {
  return deckOrder.filter((wordId) => !introduced.has(wordId)).slice(0, limit);
}

/** Due cards first (c1…), then the new ones. */
export function planCards(due: readonly string[], fresh: readonly string[]): Step[] {
  const cards: Step[] = due.map((wordId, n) => ({ id: `c${n + 1}`, type: 'card', wordId, new: false }));
  return [
    ...cards,
    ...fresh.map((wordId, n) => ({ id: `c${cards.length + n + 1}`, type: 'card' as const, wordId, new: true })),
  ];
}

/**
 * Another showing of `wordId` a few cards after the one just answered (index `answered`), unless
 * the word has been shown enough times this lesson. Null when it isn't added.
 */
export function requeue(plan: readonly Step[], answered: number, wordId: string): { plan: Step[]; again: Step } | null {
  const shown = plan.filter((step) => step.wordId === wordId && step.type === 'card').length;
  if (shown >= MAX_SHOWINGS_PER_SESSION) return null;
  const again: Step = { id: `c${plan.length + 1}`, type: 'card', wordId, new: false };
  const position = Math.min(plan.length, answered + 1 + REQUEUE_GAP);
  return { plan: [...plan.slice(0, position), again, ...plan.slice(position)], again };
}

// --- the day's pace (ADR 0010, 0028) --------------------------------------------------------

/** 0 or 1 while a large target warms up; null once the full target applies. */
export function rampWeek(target: number, enabled: boolean, startedOn: string | null, today: string): number | null {
  if (!enabled || startedOn === null || target < RAMP_MIN_TARGET) return null;
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startedOn}T00:00:00Z`)) / 86_400_000);
  const week = Math.floor(days / 7);
  return week >= 0 && week < RAMP_SHARES.length ? week : null;
}

export const effectiveTarget = (target: number, week: number | null) =>
  week === null ? target : Math.max(1, Math.ceil(target * RAMP_SHARES[week]));

export const reviewDebtLimit = (target: number) => Math.max(DEBT_FLOOR, 2 * REVIEWS_PER_WORD * target);

/** New words to meet today so a deck is done the day before its deadline. */
export function deadlineShare(leftAtDayStart: number, today: string, dueOn: string): number {
  if (leftAtDayStart <= 0) return 0;
  const days = Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days <= 1) return leftAtDayStart;
  return Math.ceil(leftAtDayStart / days);
}

export interface DayPlan {
  target: number;
  effectiveTarget: number;
  newToday: number;
  remaining: number;
  nextLessonSize: number;
  bonus: boolean;
  blockedByReviews: boolean;
}

/** Today in one deck: what's left of the day's new words, and the next lesson's size. */
export function planDay(
  target: number,
  week: number | null,
  newToday: number,
  due: number,
  { deadline = null as string | null, share = 0, extra = 0 } = {},
): DayPlan {
  const goal = Math.max(effectiveTarget(target, week), share) + extra;
  const remaining = Math.max(0, goal - newToday);
  return {
    target,
    effectiveTarget: goal,
    newToday,
    remaining,
    nextLessonSize: remaining ? Math.min(MAX_LESSON_WORDS, remaining) : BONUS_LESSON_WORDS,
    bonus: remaining === 0,
    // A deadline wins over the review backlog: its words must be met in time.
    blockedByReviews: due >= reviewDebtLimit(target) && deadline === null,
  };
}
