import type { Highlight } from './text.ts';

/** Highlights and notes, per account and article, on this device (the experiment's scope). */

const key = (account: string, articleId: string) => `reading-notes:${account}:${articleId}`;

export function readNotes(account: string, articleId: string): Highlight[] {
  try {
    const kept = JSON.parse(localStorage.getItem(key(account, articleId)) ?? '[]') as Highlight[];
    return Array.isArray(kept) ? kept : [];
  } catch {
    return [];
  }
}

export function saveNotes(account: string, articleId: string, highlights: readonly Highlight[]) {
  try {
    localStorage.setItem(key(account, articleId), JSON.stringify(highlights));
  } catch {
    // private mode or full storage: kept for this visit only
  }
}

/** In reading order. */
export const ordered = (highlights: readonly Highlight[]) =>
  [...highlights].sort((a, b) => a.from.p - b.from.p || a.from.o - b.from.o);
