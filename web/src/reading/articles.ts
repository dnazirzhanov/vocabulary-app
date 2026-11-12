import { api } from '../lib/api.ts';
import type { OwnReading, OwnReadings, ReadingQuestion } from '../lib/types.ts';
import { withSnapshot } from '../local/session.ts';

/**
 * Reading Mode's data (docs/product/reading-mode-architecture.md): articles are static files built
 * from content/reading/ (`app.cli build-reading`); texts people add themselves come from the API
 * (round 2), kept on this device once opened; reading progress stays on this device.
 */

export type Level = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
export type Topic = 'science' | 'technology' | 'nature' | 'society' | 'psychology' | 'history' | 'culture';

export const LEVELS: readonly Level[] = ['A1', 'A2', 'B1', 'B2', 'C1'];
export const TOPICS: readonly Topic[] = [
  'science',
  'nature',
  'technology',
  'psychology',
  'society',
  'history',
  'culture',
];

export interface ArticleCard {
  id: string;
  title: string;
  subtitle: string;
  topic: Topic;
  level: Level;
  minutes: number;
  /** How many questions it asks. */
  questions?: number;
}

/** One word form's meaning: lemma, part of speech (null for a name), meaning, explanation. */
export interface Meaning {
  l: string;
  p: string | null;
  /** In the article's `language`. */
  t: string;
  d: string | null;
}

/** An article as the reader opens it: one of the library's, or a text of my own. */
export interface Article {
  id: string;
  title: string;
  subtitle?: string;
  level: Level | null;
  topic?: Topic;
  minutes: number;
  words: number;
  source?: { name: string; url?: string; license: string; note?: string };
  /** Paragraphs; one starting with "## " is a heading. */
  body: string[];
  glossary: Record<string, Meaning>;
  /** The language its meanings are in: the library's Russian, or the owner's card language. */
  language: string;
  /** What a reader answers after reading (round 2, C). */
  questions: ReadingQuestion[];
  /** A text of my own: whether its meanings are ready yet. */
  own?: { status: OwnReading['status']; categoryId: string | null };
}

/** A text of my own is named by its id; the library's articles by a short name. */
export const isOwn = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(id);

let index: Promise<ArticleCard[]> | null = null;

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return (await response.json()) as T;
}

/** The library, fetched once per visit (the service worker keeps it for offline). */
export function loadIndex(): Promise<ArticleCard[]> {
  index ??= getJson<{ articles: ArticleCard[] }>('/reading/index.json').then(
    (data) => data.articles,
    (error: unknown) => {
      index = null; // a failed load is tried again next time
      throw error;
    },
  );
  return index;
}

interface BuiltArticle extends Omit<Article, 'glossary' | 'language' | 'own'> {
  glossary: Record<string, { l: string; p: string | null; ru: string; d: string | null }>;
}

/** A library article (its meanings are Russian), or a text of mine, kept here once opened. */
export async function loadArticle(id: string): Promise<Article> {
  if (isOwn(id)) return ownArticle((await withSnapshot(`reading:${id}`, () => api.reading(id))).value);
  const built = await getJson<BuiltArticle>(`/reading/${encodeURIComponent(id)}.json`);
  const glossary = Object.fromEntries(
    Object.entries(built.glossary).map(([form, { l, p, ru, d }]) => [form, { l, p, t: ru, d }]),
  );
  return { ...built, glossary, language: 'ru' };
}

export const ownArticle = (reading: OwnReading): Article => ({
  id: reading.id,
  title: reading.title,
  level: (reading.level as Level | null) ?? null,
  minutes: reading.minutes,
  words: reading.words,
  body: reading.body,
  glossary: reading.glossary,
  language: reading.language,
  questions: reading.questions ?? [],
  own: { status: reading.status, categoryId: reading.category_id },
});

/** My texts and categories; without a connection, as this device last saw them. */
export const loadOwn = (): Promise<OwnReadings> => withSnapshot('readings', api.readings).then(({ value }) => value);

export const HEADING = '## ';

/** Minutes left to read when `read` of `total` paragraphs are done. */
export const minutesLeft = (minutes: number, read: number, total: number) =>
  total === 0 ? minutes : Math.max(1, Math.ceil((minutes * (total - read)) / total));

// --- progress, on this device, per account -------------------------------------------------------

export interface Progress {
  /** The furthest paragraph seen. */
  at: number;
  of: number;
  /** When «Готово» was pressed. */
  doneAt?: string;
}

const progressKey = (account: string) => `reading-progress:${account}`;

export function readProgress(account: string): Record<string, Progress> {
  try {
    return JSON.parse(localStorage.getItem(progressKey(account)) ?? '{}') as Record<string, Progress>;
  } catch {
    return {};
  }
}

export function saveProgress(account: string, articleId: string, update: (now: Progress | undefined) => Progress) {
  try {
    const all = readProgress(account);
    all[articleId] = update(all[articleId]);
    localStorage.setItem(progressKey(account), JSON.stringify(all));
  } catch {
    // private mode or full storage: progress lasts for this visit only
  }
}

// --- how the text looks, on this device ----------------------------------------------------------

export type Theme = 'paper' | 'sepia' | 'night';
export const MIN_SIZE = 16;
export const MAX_SIZE = 24;
export const DEFAULT_SIZE = 19;

export interface Appearance {
  theme: Theme;
  size: number;
}

const APPEARANCE_KEY = 'reading-appearance';

export function readAppearance(): Appearance {
  try {
    const kept = JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? '{}') as Partial<Appearance>;
    const theme = kept.theme === 'sepia' || kept.theme === 'night' ? kept.theme : 'paper';
    const size = Number.isFinite(kept.size) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, kept.size!)) : DEFAULT_SIZE;
    return { theme, size };
  } catch {
    return { theme: 'paper', size: DEFAULT_SIZE };
  }
}

export function saveAppearance(appearance: Appearance) {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
  } catch {
    // private mode: the choice lasts for this visit only
  }
}
