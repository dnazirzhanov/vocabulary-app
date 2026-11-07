import type { LibraryDeck } from '../lib/types.ts';
import type { LocalDeck } from './db.ts';

/** One of my decks as this device has it, with how many cards it holds. */
export interface KeptDeck {
  deck: LocalDeck;
  cards: number;
}

/**
 * «Мои колоды» from the server's list (its counts of what I studied) and this device's own decks
 * (what I made, renamed or deleted here, maybe not sent yet). Once this device has pulled my decks,
 * a deck it doesn't have was deleted here, and isn't shown. A deck made here and not yet on the
 * server shows with nothing studied.
 */
export function mergeMine(server: LibraryDeck[], kept: KeptDeck[] | null, pulled: boolean): LibraryDeck[] {
  if (!kept) return server;
  const here = new Map(kept.map((item) => [item.deck.id, item]));
  const fromServer = server
    .filter((deck) => here.has(deck.id) || !pulled)
    .map((deck) => {
      const mine = here.get(deck.id);
      return mine ? { ...deck, title: mine.deck.title, word_count: mine.cards } : deck;
    });
  const onServer = new Set(server.map((deck) => deck.id));
  const madeHere = kept
    .filter((item) => !onServer.has(item.deck.id))
    .sort((a, b) => b.deck.createdAt.localeCompare(a.deck.createdAt))
    .map(({ deck, cards }) => ({
      id: deck.id,
      title: deck.title,
      word_count: cards,
      introduced_count: 0,
      learning_count: 0,
      review_count: 0,
      new_today: 0,
      next_due_at: null,
      due_on: null,
      groups: [],
      group_name: null,
      author: null,
    }));
  // Newest first, as the server lists them.
  return [...madeHere, ...fromServer];
}
