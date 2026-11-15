import { api } from '../lib/api.ts';
import type { Me, Progress } from '../lib/types.ts';
import { localDb, withSnapshot } from '../local/session.ts';
import { readSnapshot } from '../local/db.ts';
import { loadIndex, readProgress } from '../reading/articles.ts';
import { LEVELS, type Level } from '../reading/levels.ts';
import { study, type MentorDeckSummary } from '../study/device.ts';
import { phaseFor } from './greeting.ts';
import type { MentorArticle, MentorDeck, MentorInput } from './types.ts';

interface ProgressData {
  streakWeeks: number | null;
  daysSinceLastStudy: number | null;
}

const DEFAULT_LEVEL: Level = 'A2';

/**
 * Everything the planner and the tip need, gathered from the sources that already hold it: the
 * learner's `me` snapshot, the kept progress snapshot (streak), the on-device study pack, the
 * cached reading index, and the reader's own localStorage. No new API calls; `api.progress()` is
 * wrapped in `withSnapshot` so the dashboard opens offline too.
 */
export async function collectMentorInput(account: string): Promise<MentorInput> {
  const db = localDb();
  const me = db ? ((await readSnapshot<Me>(db, 'me').catch(() => null))?.value ?? null) : null;
  const { streakWeeks, daysSinceLastStudy } = await loadProgressData();
  const snapshot = await study.learnerSnapshot();
  const articles = await loadArticles();
  const readIds = new Set(doneArticleIds(account));
  const decks = toMentorDecks(snapshot?.decks ?? []);
  return {
    phase: phaseFor(new Date().getHours()),
    name: me?.name ?? null,
    streakWeeks,
    decks,
    articles,
    readIds,
    userLevel: pickUserLevel(decks),
    daysSinceLastStudy,
  };
}

async function loadProgressData(): Promise<ProgressData> {
  try {
    const { value } = await withSnapshot<Progress>('progress', api.progress);
    const streakWeeks = value.streak_weeks;
    const todayStr = new Date().toISOString().slice(0, 10);
    const lastStudied = [...value.activity].reverse().find((day) => day.studied);
    if (!lastStudied) return { streakWeeks, daysSinceLastStudy: null };
    const msPerDay = 1000 * 60 * 60 * 24;
    const days = Math.round((new Date(todayStr).getTime() - new Date(lastStudied.date).getTime()) / msPerDay);
    return { streakWeeks, daysSinceLastStudy: days };
  } catch {
    return { streakWeeks: null, daysSinceLastStudy: null };
  }
}

async function loadArticles(): Promise<MentorArticle[]> {
  try {
    const index = await loadIndex();
    return index.map((card) => ({ id: card.id, title: card.title, level: card.level, minutes: card.minutes }));
  } catch {
    return [];
  }
}

function doneArticleIds(account: string): string[] {
  try {
    const all = readProgress(account);
    return Object.entries(all)
      .filter(([, progress]) => Boolean(progress.doneAt))
      .map(([id]) => id);
  } catch {
    return [];
  }
}

function toMentorDecks(decks: readonly MentorDeckSummary[]): MentorDeck[] {
  return decks.map((deck) => ({
    id: deck.id,
    title: deck.title,
    level: deck.level,
    levelOrder: deck.levelOrder,
    dueCount: deck.dueCount,
    spellingDue: deck.spellingDue,
  }));
}

/**
 * The level the reading library tries to match: the lowest course level that still has work left.
 * Without a course deck on this device, the default (A2) keeps the picker from returning nothing.
 */
function pickUserLevel(decks: readonly MentorDeck[]): Level {
  const withLevels = decks
    .filter((deck) => deck.level !== null && LEVELS.includes(deck.level as Level))
    .sort((a, b) => (a.levelOrder ?? 99) - (b.levelOrder ?? 99));
  return (withLevels[0]?.level as Level | undefined) ?? DEFAULT_LEVEL;
}
