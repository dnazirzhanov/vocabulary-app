import { wordsLabel } from './pace.ts';
import type { Deck } from './types.ts';

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

/** The level the learner is on: the last one open (later levels wait until it is met). */
export function currentDeck(decks: Deck[]): Deck | undefined {
  return decks.filter((deck) => !deck.locked).at(-1);
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

/** «1 новое слово», «3 новых слова», «5 новых слов». */
export const newWords = (n: number) =>
  `${n}\u00a0${n % 10 === 1 && n % 100 !== 11 ? 'новое слово' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'новых слова' : 'новых слов'}`;
