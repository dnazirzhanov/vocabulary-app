/**
 * Reading Mode's data (docs/product/reading-mode-architecture.md): articles are static files built
 * from content/reading/ (`app.cli build-reading`), and reading progress stays on this device.
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
}

/** One word form's meaning, as built: lemma, part of speech (null for a name), Russian, note. */
export interface Meaning {
  l: string;
  p: string | null;
  ru: string;
  d: string | null;
}

export interface Article extends ArticleCard {
  words: number;
  source: { name: string; url?: string; license: string; note?: string };
  /** Paragraphs; one starting with "## " is a heading. */
  body: string[];
  glossary: Record<string, Meaning>;
}

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

export const loadArticle = (id: string) => getJson<Article>(`/reading/${encodeURIComponent(id)}.json`);

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
