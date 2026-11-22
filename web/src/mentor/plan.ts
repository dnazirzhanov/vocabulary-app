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
 * «Today's plan»: all vocab decks with due cards, all spelling decks with due words, then one
 * reading item. Each deck is a separate task card. Vocab → spelling → reading order.
 * Nothing is invented when the inputs are empty.
 */
export function planToday(input: MentorInput): PlanItem[] {
  const items: PlanItem[] = [];

  for (const deck of input.decks.filter((d) => d.dueCount >= VOCAB_DUE_MIN).sort(byDueDesc)) {
    items.push({
      kind: 'vocab',
      deckId: deck.id,
      title: deck.title,
      count: deck.dueCount,
      minutes: estimateVocabMinutes(deck.dueCount),
    });
  }

  for (const deck of input.decks.filter((d) => d.spellingDue >= SPELL_DUE_MIN).sort(bySpellingDesc)) {
    items.push({
      kind: 'spelling',
      deckId: deck.id,
      title: deck.title,
      count: deck.spellingDue,
      minutes: estimateSpellingMinutes(deck.spellingDue),
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

  if (input.dailyMinutes !== null && input.dailyMinutes > 0) {
    const capped: PlanItem[] = [];
    let total = 0;
    for (const item of items) {
      if (capped.length === 0 || total + item.minutes <= input.dailyMinutes) {
        capped.push(item);
        total += item.minutes;
      }
    }
    return capped;
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

/** Minutes for one essay and one spoken answer, the coach's own estimates (ADR 0071). */
export const SECTION_MINUTES = { writing: 15, speaking: 5 } as const;

/**
 * Today's plan with the coach's week in it (ADR 0071): when writing or speaking is behind for
 * this point of the week, one essay or one spoken answer joins the list, within the day's minutes.
 * Due reviews stay first: memory doesn't wait.
 */
export function withWeek(
  items: PlanItem[],
  behind: readonly string[],
  dailyMinutes: number | null,
  titles: { writing: string; speaking: string },
): PlanItem[] {
  const extra: PlanItem[] = [];
  for (const skill of behind) {
    if (skill === 'writing' || skill === 'speaking') {
      extra.push({ kind: skill, title: titles[skill], minutes: SECTION_MINUTES[skill] });
    }
  }
  const all = [...items, ...extra];
  if (dailyMinutes === null || dailyMinutes <= 0) return all;
  const kept: PlanItem[] = [];
  let total = 0;
  for (const item of all) {
    if (kept.length === 0 || total + item.minutes <= dailyMinutes) {
      kept.push(item);
      total += item.minutes;
    }
  }
  return kept;
}
