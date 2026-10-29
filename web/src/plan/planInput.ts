import { serverNow } from '../lib/clock.ts';
import { startOfDay, type RoadmapInput } from '../lib/roadmap.ts';
import type { Deck } from '../lib/types.ts';

export interface PaceChoice {
  words: number;
  days: number;
  ramp: boolean;
}

/** The course goal (1,300 words) when the deck has a sourced one, otherwise the deck itself. */
export const goalWordsOf = (deck: Deck) => Math.max(deck.course_goal?.target_words ?? 0, deck.word_count);

// API timestamps are UTC instants; the ramp counts the learner's local calendar days.
const localDay = (iso: string | null) => (iso ? startOfDay(new Date(iso)) : null);

/** "If you keep this pace": from today's real position to the course goal. */
export function planInput(deck: Deck, choice: PaceChoice, metToday: number, onboardedAt: string | null): RoadmapInput {
  const today = startOfDay(serverNow());
  return {
    today,
    totalWords: goalWordsOf(deck),
    introduced: deck.introduced_count,
    metToday,
    wordsPerDay: choice.words,
    studyDaysPerWeek: choice.days,
    ramp: choice.ramp,
    rampStartedOn: localDay(onboardedAt) ?? today,
  };
}
