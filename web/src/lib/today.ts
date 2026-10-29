import { wordsLabel } from './pace.ts';
import type { Deck, Pace } from './types.ts';

/**
 * What there is to do today, the way Anki counts it (ADR 0014): new words still allowed by today's
 * pace, cards in short learning steps, and long-term reviews that are due.
 */
export interface Counts {
  fresh: number;
  learning: number;
  review: number;
}

export const countsOf = (deck: Deck): Counts => ({
  fresh: deck.new_today,
  learning: deck.learning_count,
  review: deck.review_count,
});

export function courseCounts(decks: Deck[]): Counts {
  return decks.map(countsOf).reduce(
    (sum, counts) => ({
      fresh: sum.fresh + counts.fresh,
      learning: sum.learning + counts.learning,
      review: sum.review + counts.review,
    }),
    { fresh: 0, learning: 0, review: 0 },
  );
}

/** The level the learner is on: the last one open (later levels wait until it is met). */
export function currentDeck(decks: Deck[]): Deck | undefined {
  return decks.filter((deck) => deck.kind === 'course' && !deck.locked).at(-1);
}

/** Where the next lesson's new words come from: decks given to my groups, then the current level
 * (ADR 0017). */
export function lessonDecks(decks: Deck[]): Deck[] {
  const current = currentDeck(decks);
  return [...decks.filter((deck) => deck.kind === 'group'), ...(current ? [current] : [])];
}

/** The earliest upcoming review of these decks, when nothing is due. */
export function nextDueAt(decks: Deck[]): string | null {
  const upcoming = decks.flatMap((deck) => (deck.next_due_at ? [deck.next_due_at] : []));
  return upcoming.length ? upcoming.reduce((a, b) => (new Date(a) < new Date(b) ? a : b)) : null;
}

/**
 * New words the next study session brings from these decks (lessonDecks): none once they are fully
 * met or while too many reviews are due anywhere in the course; after today's target, a bonus
 * lesson (ADR 0010).
 */
export function newInSession(decks: Deck[], pace: Pace | null): number {
  const left = decks.reduce((sum, deck) => sum + deck.word_count - deck.introduced_count, 0);
  if (left <= 0 || pace?.blocked_by_reviews) return 0;
  return Math.min(pace?.next_lesson_size ?? 5, left);
}

/** The study button: what the session holds, so pressing it never surprises. */
export function studyLabel({
  due,
  fresh,
  started,
  bonus,
}: {
  due: number;
  fresh: number;
  started: boolean;
  bonus: boolean;
}): string | null {
  if (due > 0 && fresh > 0) return `Учить · ${due} повт. + ${fresh} нов.`;
  if (due > 0) return `Повторить · ${wordsLabel(due)}`;
  if (fresh === 0) return null;
  if (!started) return `Начать урок · ${wordsLabel(fresh)}`;
  return bonus ? `Ещё ${wordsLabel(fresh)}` : `Новые слова · ${wordsLabel(fresh)}`;
}
