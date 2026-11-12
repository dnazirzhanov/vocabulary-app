import { addCard, createDeck, deckCards, myDecks, removeCard } from '../local/myDecks.ts';
import type { AccountDb, LocalCard } from '../local/db.ts';
import type { Meaning } from './articles.ts';

/**
 * An article's basket is a deck of the learner's own (docs/experiments/reading-mode/decisions.md §2):
 * made on the first «Добавить», named after the article; each saved word is a card at once, synced
 * and scheduled like any other.
 */

const mapKey = (account: string) => `reading-decks:${account}`;

function readMap(account: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(mapKey(account)) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function remember(account: string, articleId: string, deckId: string) {
  try {
    localStorage.setItem(mapKey(account), JSON.stringify({ ...readMap(account), [articleId]: deckId }));
  } catch {
    // private mode: found again by its title next time
  }
}

/** How a deck names the library article it was made from (`decks.reading_ref` on the server). */
export const readingRef = (articleId: string) => `library:${articleId}`;

/**
 * The article's deck if it exists: by the reading it was made from; a deck made before decks
 * said so, by the id kept here, else (another device) by its title.
 */
export async function findDeck(db: AccountDb, account: string, articleId: string, title: string) {
  const decks = await myDecks(db);
  const kept = readMap(account)[articleId];
  const deck =
    decks.find((one) => one.readingRef === readingRef(articleId)) ??
    decks.find((one) => one.id === kept) ??
    decks.find((one) => !one.readingRef && one.title === deckTitle(title));
  if (deck) remember(account, articleId, deck.id);
  return deck?.id ?? null;
}

/** Deck titles are at most 80 characters (`Title` in backend/app/schemas/decks.py). */
export const deckTitle = (title: string) => (title.length <= 80 ? title : `${title.slice(0, 79).trimEnd()}…`);

export async function basketCards(db: AccountDb, deckId: string | null): Promise<LocalCard[]> {
  return deckId ? deckCards(db, deckId) : [];
}

/** The card already saved for this word (by its dictionary form), if any. */
export const cardFor = (cards: readonly LocalCard[], lemma: string) =>
  cards.find((card) => card.headword.toLowerCase() === lemma.toLowerCase()) ?? null;

export async function addWord(
  db: AccountDb,
  account: string,
  article: { id: string; title: string },
  meaning: Meaning,
  sentence: string,
): Promise<string> {
  const deckId =
    (await findDeck(db, account, article.id, article.title)) ??
    (await createDeck(db, deckTitle(article.title), 'ru', new Date(), readingRef(article.id))).id;
  remember(account, article.id, deckId);
  await addCard(db, deckId, {
    headword: meaning.l,
    pos: meaning.p ?? 'other',
    translation: meaning.ru.length <= 120 ? meaning.ru : meaning.ru.slice(0, 120),
    example: sentence,
    example_translation: '',
    language: 'ru',
  });
  return deckId;
}

export const removeWord = (db: AccountDb, cardId: string) => removeCard(db, cardId);
