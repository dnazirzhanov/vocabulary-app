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
