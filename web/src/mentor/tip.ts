import type { MentorInput, Tip } from './types.ts';

const STREAK_MILESTONE_EVERY = 4;
const BIG_BACKLOG = 50;
const DUE_IN_DECK = 10;
const SPELLING_AWAITS = 5;

/**
 * One line for the learner. First match wins, so earlier rules are the more specific.
 * Numbers come from real inputs; no rule returns text or numbers the learner did not actually have.
 */
export function pickTip(input: MentorInput): Tip {
  const totalDue = input.decks.reduce((sum, deck) => sum + deck.dueCount, 0);
  const totalSpelling = input.decks.reduce((sum, deck) => sum + deck.spellingDue, 0);
  const topDeck = input.decks.slice().sort((a, b) => b.dueCount - a.dueCount)[0] ?? null;

  if (input.decks.length === 0 && (input.streakWeeks ?? 0) === 0) {
    return { id: 'firstRun' };
  }
  if (
    input.streakWeeks &&
    input.streakWeeks >= STREAK_MILESTONE_EVERY &&
    input.streakWeeks % STREAK_MILESTONE_EVERY === 0
  ) {
    return { id: 'streakMilestone', weeks: input.streakWeeks };
  }
  if (input.streakWeeks && input.streakWeeks > 0) {
    return { id: 'streakKeep', weeks: input.streakWeeks };
  }
  if (totalDue >= BIG_BACKLOG) {
    return { id: 'bigBacklog', total: totalDue };
  }
  if (topDeck && topDeck.dueCount >= DUE_IN_DECK) {
    return { id: 'dueInDeck', count: topDeck.dueCount, deckTitle: topDeck.title };
  }
  if (totalSpelling >= SPELLING_AWAITS) {
    return { id: 'spellingAwaits', count: totalSpelling };
  }
  // A first-week learner with a modest backlog: more encouraging than the generic default.
  if (input.decks.length > 0 && (input.streakWeeks ?? 0) === 0 && totalDue > 0) {
    return { id: 'newLearner' };
  }
  if (input.decks.length > 0 && totalDue === 0 && totalSpelling === 0) {
    return { id: 'allCaughtUp' };
  }
  if (totalDue === 0 && hasReading(input)) {
    return { id: 'readingFresh' };
  }
  return { id: 'default' };
}

function hasReading(input: MentorInput): boolean {
  return input.articles.some((article) => !input.readIds.has(article.id));
}
