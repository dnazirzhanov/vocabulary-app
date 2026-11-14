import { LEVELS, type Level } from '../reading/levels.ts';
import type { MentorArticle, MentorDeck, MentorInput, PlanItem } from './types.ts';

const VOCAB_DUE_MIN = 1;
const SPELL_DUE_MIN = 1;
const SECONDS_PER_CARD = 10;
const SECONDS_PER_SPELLING = 15;
const MIN_MINUTES = 1;
const MAX_MINUTES = 15;

/** A rough estimate for the first cards of a session. Not a prediction per learner. */
export function estimateVocabMinutes(count: number): number {
  return bound(Math.ceil((count * SECONDS_PER_CARD) / 60));
}

export function estimateSpellingMinutes(count: number): number {
  return bound(Math.ceil((count * SECONDS_PER_SPELLING) / 60));
}

function bound(value: number): number {
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, value));
}

function byDueDesc(a: MentorDeck, b: MentorDeck): number {
  return b.dueCount - a.dueCount || (a.levelOrder ?? 99) - (b.levelOrder ?? 99) || a.title.localeCompare(b.title);
}

function bySpellingDesc(a: MentorDeck, b: MentorDeck): number {
  return b.spellingDue - a.spellingDue || (a.levelOrder ?? 99) - (b.levelOrder ?? 99) || a.title.localeCompare(b.title);
}

/** The reading library item fits when it is within one level of the learner's. */
export function levelFits(article: Level, user: Level): boolean {
  const a = LEVELS.indexOf(article);
  const u = LEVELS.indexOf(user);
  return a !== -1 && u !== -1 && Math.abs(a - u) <= 1;
}

/**
 * «Today's plan»: 0–3 cards, in a steady order (vocab → spelling → reading). A kind that produces
 * nothing is skipped; nothing is invented when the inputs are empty.
 */
export function planToday(input: MentorInput): PlanItem[] {
  const items: PlanItem[] = [];

  const vocab = input.decks.filter((deck) => deck.dueCount >= VOCAB_DUE_MIN).sort(byDueDesc)[0];
  if (vocab) {
    items.push({
      kind: 'vocab',
      deckId: vocab.id,
      title: vocab.title,
      count: vocab.dueCount,
      minutes: estimateVocabMinutes(vocab.dueCount),
    });
  }

  const spelling = input.decks.filter((deck) => deck.spellingDue >= SPELL_DUE_MIN).sort(bySpellingDesc)[0];
  if (spelling) {
    items.push({
      kind: 'spelling',
      deckId: spelling.id,
      title: spelling.title,
      count: spelling.spellingDue,
      minutes: estimateSpellingMinutes(spelling.spellingDue),
    });
  }

  const reading = pickReading(input.articles, input.readIds, input.userLevel);
  if (reading) {
    items.push({
      kind: 'reading',
      articleId: reading.id,
      title: reading.title,
      level: reading.level,
      minutes: reading.minutes,
    });
  }

  return items;
}

function pickReading(
  articles: readonly MentorArticle[],
  readIds: ReadonlySet<string>,
  userLevel: Level,
): MentorArticle | null {
  const unread = articles.filter((article) => !readIds.has(article.id));
  const exact = unread.filter((article) => article.level === userLevel);
  const candidates = exact.length > 0 ? exact : unread.filter((article) => levelFits(article.level, userLevel));
  return candidates.sort((a, b) => a.minutes - b.minutes || a.title.localeCompare(b.title))[0] ?? null;
}
