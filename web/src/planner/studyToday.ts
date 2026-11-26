/** Loads «Учёба на сегодня» (ADR 0087) from what the app keeps: works offline too. */
import { api } from '../lib/api.ts';
import type { Deck, Library } from '../lib/types.ts';
import { withSnapshot } from '../local/session.ts';
import { study } from '../study/device.ts';
import { studyToday, withSeen, type StudyItem } from './studyPlan.ts';
import { localToday } from './dates.ts';

export type { StudyItem };

/** From what the app keeps (works offline too): the course, my and my groups' decks, spelling. */
const seenKey = (day: string) => `plans-study:${day}`;

function readSeen(day: string): Record<string, StudyItem> {
  try {
    return JSON.parse(localStorage.getItem(seenKey(day)) ?? '{}') as Record<string, StudyItem>;
  } catch {
    return {};
  }
}

function keepSeen(day: string, seen: Record<string, StudyItem>) {
  try {
    localStorage.setItem(seenKey(day), JSON.stringify(seen));
    // Yesterday's list is of no use any more.
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith('plans-study:') && key !== seenKey(day)) localStorage.removeItem(key);
    }
  } catch {
    // Storage blocked: finished decks just leave the list, as before.
  }
}

/** Today's study list with what was finished today ticked (ADR 0089); `fresh`: just finished. */
export async function loadStudyDay(): Promise<{ items: StudyItem[]; fresh: string[] }> {
  const day = localToday();
  const { items: pending, decks } = await loadStudyToday();
  const { items, seen, fresh } = withSeen(pending, readSeen(day), decks);
  keepSeen(day, seen);
  return { items, fresh };
}

/** What waits today, and every deck I still have (null if that couldn't be told). */
export async function loadStudyToday(): Promise<{ items: StudyItem[]; decks: Set<string> | null }> {
  const [course, library, snapshot] = await Promise.all([
    withSnapshot<Deck[]>('courseDecks', () => api.listDecks())
      .then((r) => r.value)
      .catch(() => []),
    withSnapshot<Library>('library', () => api.library())
      .then((r) => r.value)
      .catch(() => null),
    study.learnerSnapshot().catch(() => null),
  ]);
  const spelling = snapshot?.decks ?? [];
  const decks = library
    ? new Set([
        ...course.map((d) => d.id),
        ...library.mine.map((d) => d.id),
        ...library.from_groups.map((d) => d.id),
        ...spelling.map((d) => d.id),
      ])
    : null;
  return { items: studyToday(course, library, spelling), decks };
}
