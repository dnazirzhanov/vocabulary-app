/**
 * «Учёба на сегодня» (ADR 0087): what to study today, worked out by the app so nobody has to
 * figure it out. Each deck with words to learn or review today, a teacher's deadline first; then
 * each deck with spelling due. Nothing is invented: only decks with something waiting.
 */
import type { Deck, Library, LibraryDeck } from '../lib/types.ts';

export interface StudyItem {
  key: string;
  kind: 'learn' | 'spell';
  deckId: string;
  title: string;
  /** learn: new words today, and cards due; spell: words due. */
  newCount: number;
  dueCount: number;
  /** A teacher's «Выучить к» (ADR 0030). */
  dueOn: string | null;
  group: string | null;
  /** Was on today's list and has nothing left now: studied today (ADR 0089). */
  done?: boolean;
}

export interface SpellingDeck {
  id: string;
  title: string;
  spellingDue: number;
}

const waiting = (d: LibraryDeck) => d.new_today + d.learning_count + d.review_count;

export function studyToday(course: Deck[], library: Library | null, spelling: SpellingDeck[]): StudyItem[] {
  const learn = (deck: LibraryDeck | Deck, dueOn: string | null, group: string | null): StudyItem => ({
    key: `learn:${deck.id}`,
    kind: 'learn',
    deckId: deck.id,
    title: deck.title,
    newCount: deck.new_today,
    dueCount: deck.learning_count + deck.review_count,
    dueOn,
    group,
  });
  const fromGroups = (library?.from_groups ?? []).filter((d) => waiting(d) > 0);
  // A deadline first, the nearest first; then the course by level; then the rest.
  const withDeadline = fromGroups
    .filter((d) => d.due_on)
    .sort((a, b) => (a.due_on ?? '').localeCompare(b.due_on ?? ''))
    .map((d) => learn(d, d.due_on ?? null, groupOf(d)));
  const courseItems = course
    .filter((d) => !d.locked && d.new_today + d.learning_count + d.review_count > 0)
    .sort((a, b) => a.level_order - b.level_order)
    .map((d) => learn(d, null, null));
  const groupItems = fromGroups.filter((d) => !d.due_on).map((d) => learn(d, null, groupOf(d)));
  const mine = (library?.mine ?? []).filter((d) => waiting(d) > 0).map((d) => learn(d, null, null));
  const seen = new Set<string>();
  const learnItems = [...withDeadline, ...courseItems, ...groupItems, ...mine].filter((item) =>
    seen.has(item.deckId) ? false : (seen.add(item.deckId), true),
  );
  const spellItems = spelling
    .filter((d) => d.spellingDue > 0)
    .sort((a, b) => b.spellingDue - a.spellingDue || a.title.localeCompare(b.title))
    .map((d): StudyItem => ({
      key: `spell:${d.id}`,
      kind: 'spell',
      deckId: d.id,
      title: d.title,
      newCount: 0,
      dueCount: d.spellingDue,
      dueOn: null,
      group: null,
    }));
  return [...learnItems, ...spellItems];
}

const groupOf = (deck: LibraryDeck): string | null => deck.group_name;

/**
 * Today's list as the learner saw it (ADR 0089): what is waiting now, and what was waiting earlier
 * today and isn't any more, which they finished, shown ticked. `seen` is what this device kept
 * from earlier today; the result's `seen` is to keep. `fresh` are the ones finished since the last
 * look, for the tick's celebration. A deck no longer there is dropped (ADR 0093).
 */
export function withSeen(
  pending: StudyItem[],
  seen: Record<string, StudyItem>,
  /** The decks I still have; null when that couldn't be told (then nothing is dropped). */
  exists: ReadonlySet<string> | null = null,
): { items: StudyItem[]; seen: Record<string, StudyItem>; fresh: string[] } {
  const waiting = new Set(pending.map((item) => item.key));
  // A deck with nothing left was finished, unless it is gone: deleted, left with its group, or
  // hidden. Then it leaves the list, not ticked.
  const finished = Object.values(seen)
    .filter((item) => !waiting.has(item.key))
    .filter((item) => !exists || exists.has(item.deckId))
    .map((item) => ({ ...item, done: true }));
  const fresh = finished.filter((item) => !seen[item.key].done).map((item) => item.key);
  const kept: Record<string, StudyItem> = {};
  for (const item of [...pending, ...finished]) kept[item.key] = item;
  return { items: [...pending, ...finished], seen: kept, fresh };
}
