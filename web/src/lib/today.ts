import { wordsLabel } from './pace.ts';
import type { Deck } from './types.ts';
import { t } from '../i18n/index.ts';

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
  if (due > 0 && fresh > 0) return t.studyRevNew(due, fresh);
  if (due > 0) return t.review(wordsLabel(due));
  if (fresh === 0) return null;
  if (!started) return t.startLesson(wordsLabel(fresh));
  return bonus ? t.moreWords(wordsLabel(fresh)) : t.newWordsLabel(wordsLabel(fresh));
}

/** «1 новое слово», «3 новых слова», «5 новых слов». */
export const newWords = (n: number) => t.newWordsCount(n);
