import type { CardLanguage } from '../i18n/languages.ts';
import type { TeacherDeck } from '../lib/types.ts';
import type { AccountDb, Problem } from './db.ts';
import { deckCards, waitingIds } from './myDecks.ts';

/** The editor's deck from this device, and what of it is waiting to be sent or needs a choice. */
export interface DeckView {
  deck: TeacherDeck;
  waiting: Set<string>;
  problems: Map<string, Problem>;
  deckProblem: Problem | undefined;
}

/**
 * My deck as this device has it, in the editor's shape. What only the server knows (a card's
 * warnings, the text it was drafted from, the groups it is given to) comes from its last answer,
 * when there was one; a card made offline has none yet. Null when the deck isn't on this device.
 */
export async function deckView(db: AccountDb, deckId: string, server: TeacherDeck | null): Promise<DeckView | null> {
  const deck = await db.get('decks', deckId);
  if (!deck) return null;
  const cards = await deckCards(db, deckId);
  const known = new Map(server?.words.map((entry) => [entry.word.id, entry]) ?? []);
  return {
    deck: {
      id: deck.id,
      title: deck.title,
      language: deck.language as CardLanguage,
      status: deck.status as TeacherDeck['status'],
      created_at: deck.createdAt,
      words: cards.map((card) => ({
        word: {
          id: card.id,
          headword: card.headword,
          pos: card.pos,
          translation: card.translation,
          example: card.example,
          example_translation: card.example_translation,
          language: card.language as CardLanguage,
          illustration: null,
        },
        from_course: card.fromCourse,
        source_sentence: known.get(card.id)?.source_sentence ?? null,
        // The server's warnings hold for the card as it was then: not for one changed since.
        flags: known.get(card.id)?.word.translation === card.translation ? (known.get(card.id)?.flags ?? []) : [],
      })),
      groups: server?.groups ?? [],
      topics: server?.topics ?? [],
      photos_left: server?.photos_left ?? 0,
    },
    waiting: await waitingIds(db),
    problems: new Map(cards.filter((card) => card.problem).map((card) => [card.id, card.problem!])),
    deckProblem: deck.problem,
  };
}
