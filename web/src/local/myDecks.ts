import type { AccountDb, LocalCard, LocalDeck, LostChanges, OutboxOp, Problem, SyncState } from './db.ts';

/**
 * My decks on this device (ADR 0061). Every change is one transaction: the deck or card as it now
 * is, and the operation the server will be sent. Nothing here needs a connection. The rules are
 * the server's (backend/app/schemas/decks.py, services/decks.py), checked here first so a change
 * made offline is as good as one made online; the server checks again.
 *
 * Unsent changes are merged where that can't change the outcome: edits of one card become one
 * edit (keeping what the card was before the first), a card made and changed is made as changed,
 * and a card or deck made and deleted before anything was sent is simply never sent. Changes
 * already on their way are never touched.
 */

export const HEADWORD = /^[a-z]+([ '-][a-z]+)*$/;
export const MAX_WORDS_PER_DECK = 500;
export const MAX_DECKS = 100;
const CARD_FIELDS = ['headword', 'pos', 'translation', 'example', 'example_translation', 'language'] as const;
type CardField = (typeof CARD_FIELDS)[number];
export type CardInput = Pick<LocalCard, CardField>;

/** A change refused on the device, with the code the server would answer (lib/api.ts MESSAGES). */
export class LocalError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export const newId = (prefix: 'g' | 't') => `${prefix}-${crypto.randomUUID()}`;

function cleanTitle(raw: string): string {
  const title = raw.trim();
  if (title.length < 2 || title.length > 80) throw new LocalError('invalid_request');
  return title;
}

/** The card as the server would store it: trimmed, the word in small letters, within its limits. */
export function cleanCard(input: CardInput): CardInput {
  const card = {
    headword: input.headword.trim().toLowerCase().replace(/\s+/g, ' '),
    pos: input.pos,
    translation: input.translation.trim(),
    example: input.example.trim(),
    example_translation: input.example_translation.trim(),
    language: input.language,
  };
  const fits =
    HEADWORD.test(card.headword) &&
    card.headword.length <= 64 &&
    card.translation.length >= 1 &&
    card.translation.length <= 120 &&
    card.example.length >= 1 &&
    card.example.length <= 300 &&
    card.example_translation.length <= 300;
  if (!fits) throw new LocalError('invalid_request');
  return card;
}

const op = (fields: Omit<OutboxOp, 'opId' | 'createdAt' | 'status' | 'attempts'>, now: Date): OutboxOp => ({
  ...fields,
  opId: crypto.randomUUID(),
  createdAt: now.toISOString(),
  status: 'pending',
  attempts: 0,
});

type Tx = ReturnType<typeof write>;
const write = (db: AccountDb) => db.transaction(['decks', 'cards', 'outbox'], 'readwrite');
type SyncTx = ReturnType<typeof writeAll>;
const writeAll = (db: AccountDb) => db.transaction(['decks', 'cards', 'outbox', 'sync', 'answers'], 'readwrite');

async function addNotice(tx: SyncTx, field: 'lost' | 'refused', count: number) {
  const sync = tx.objectStore('sync');
  const before = ((await sync.get('notices')) as LostChanges | undefined) ?? { key: 'notices', lost: 0 };
  await sync.put({ ...before, [field]: (before[field] ?? 0) + count });
}

const addLost = (tx: SyncTx, count: number) => addNotice(tx, 'lost', count);

/**
 * A study answer's result (ADR 0062): taken, it stays applied on this device until the next pack
 * has it; refused, it goes, and is said.
 */
async function settleAnswer(tx: SyncTx, item: OutboxOp, result: OpResult) {
  const answers = tx.objectStore('answers');
  const kept = await answers.index('byOp').get(item.opId);
  if (result.status === 'rejected') {
    if (kept) await answers.delete(kept.seq!);
    await addNotice(tx, 'refused', 1);
  } else if (kept) {
    await answers.put({ ...kept, acked: true });
  }
}

async function unsent(tx: Tx, index: 'byDeck' | 'byWord', key: string): Promise<OutboxOp[]> {
  const ops = await tx.objectStore('outbox').index(index).getAll(key);
  return ops.filter((item) => item.status === 'pending');
}

export async function myDecks(db: AccountDb): Promise<LocalDeck[]> {
  return db.getAll('decks');
}

export async function deckCards(db: AccountDb, deckId: string): Promise<LocalCard[]> {
  const cards = await db.getAllFromIndex('cards', 'byDeck', deckId);
  return cards.sort((a, b) => a.position - b.position);
}

/** Changes made here and not yet on the server; shown, so nobody signs out unaware. */
export async function waiting(db: AccountDb): Promise<number> {
  return db.count('outbox');
}

/** Cards and decks with a change waiting: shown as «ждёт отправки». */
export async function waitingIds(db: AccountDb): Promise<Set<string>> {
  const ops = await db.getAll('outbox');
  return new Set(
    ops
      .flatMap((item) => [item.wordId, item.kind.startsWith('deck.') ? item.deckId : undefined])
      .filter((id): id is string => Boolean(id)),
  );
}

export async function createDeck(
  db: AccountDb,
  rawTitle: string,
  language: string,
  now = new Date(),
  readingRef?: string,
): Promise<LocalDeck> {
  const title = cleanTitle(rawTitle);
  const tx = write(db);
  if ((await tx.objectStore('decks').count()) >= MAX_DECKS) throw new LocalError('too_many_decks');
  const deck: LocalDeck = {
    id: newId('g'),
    title,
    language,
    status: 'draft',
    version: 0,
    createdAt: now.toISOString(),
    ...(readingRef && { readingRef }),
  };
  await tx.objectStore('decks').add(deck);
  const payload = { deck_id: deck.id, title, language, ...(readingRef && { reading_ref: readingRef }) };
  await tx.objectStore('outbox').add(op({ kind: 'deck.create', deckId: deck.id, payload }, now));
  await tx.done;
  return deck;
}

async function ownDeck(tx: Tx, deckId: string): Promise<LocalDeck> {
  const deck = await tx.objectStore('decks').get(deckId);
  if (!deck) throw new LocalError('deck_not_found');
  return deck;
}

export async function renameDeck(db: AccountDb, deckId: string, rawTitle: string, now = new Date()): Promise<void> {
  const title = cleanTitle(rawTitle);
  const tx = write(db);
  const deck = await ownDeck(tx, deckId);
  if (deck.title === title) return tx.done;
  const pending = await unsent(tx, 'byDeck', deckId);
  const create = pending.find((item) => item.kind === 'deck.create');
  const rename = pending.find((item) => item.kind === 'deck.rename');
  if (create) await tx.objectStore('outbox').put({ ...create, payload: { ...create.payload, title } });
  else if (rename) await tx.objectStore('outbox').put({ ...rename, payload: { ...rename.payload, title } });
  else
    await tx
      .objectStore('outbox')
      .add(op({ kind: 'deck.rename', deckId, payload: { deck_id: deckId, title, base_title: deck.title } }, now));
  await tx.objectStore('decks').put({ ...deck, title, problem: undefined });
  await tx.done;
}

async function checkRoom(tx: Tx, deckId: string, headword: string, but?: string) {
  const cards = await tx.objectStore('cards').index('byDeck').getAll(deckId);
  if (!but && cards.length >= MAX_WORDS_PER_DECK) throw new LocalError('deck_full');
  if (cards.some((card) => card.id !== but && card.headword.toLowerCase() === headword))
    throw new LocalError('word_in_deck');
  return cards;
}

export async function addCard(db: AccountDb, deckId: string, input: CardInput, now = new Date()): Promise<LocalCard> {
  const fields = cleanCard(input);
  const tx = write(db);
  await ownDeck(tx, deckId);
  const cards = await checkRoom(tx, deckId, fields.headword);
  const card: LocalCard = {
    ...fields,
    id: newId('t'),
    deckId,
    version: 0,
    position: Math.max(0, ...cards.map((item) => item.position)) + 1,
    fromCourse: false,
  };
  await tx.objectStore('cards').add(card);
  await tx
    .objectStore('outbox')
    .add(
      op(
        { kind: 'card.create', deckId, wordId: card.id, payload: { deck_id: deckId, word_id: card.id, card: fields } },
        now,
      ),
    );
  await tx.done;
  return card;
}

export async function editCard(db: AccountDb, cardId: string, input: CardInput, now = new Date()): Promise<void> {
  const fields = cleanCard(input);
  const tx = write(db);
  const card = await tx.objectStore('cards').get(cardId);
  if (!card) throw new LocalError('word_not_found');
  if (card.fromCourse) throw new LocalError('course_word');
  await checkRoom(tx, card.deckId, fields.headword, card.id);
  const changed = CARD_FIELDS.filter((field) => fields[field] !== card[field]);
  if (changed.length === 0) return tx.done;
  const pending = await unsent(tx, 'byWord', cardId);
  const create = pending.find((item) => item.kind === 'card.create');
  const update = pending.find((item) => item.kind === 'card.update');
  const outbox = tx.objectStore('outbox');
  if (create) {
    await outbox.put({ ...create, payload: { ...create.payload, card: fields } });
  } else if (card.problem?.status === 'rejected' && card.problem.code !== 'course_word' && card.version === 0) {
    // Never made on the server (it refused it): made again, as now corrected.
    await outbox.add(
      op(
        {
          kind: 'card.create',
          deckId: card.deckId,
          wordId: card.id,
          payload: { deck_id: card.deckId, word_id: card.id, card: fields },
        },
        now,
      ),
    );
  } else {
    const before = update?.payload as { fields: Record<string, unknown>; base: Record<string, unknown> } | undefined;
    const merged = { ...before?.fields, ...Object.fromEntries(changed.map((field) => [field, fields[field]])) };
    // What the card was before the first unsent change: what the server should still have.
    const base = { ...Object.fromEntries(changed.map((field) => [field, card[field]])), ...before?.base };
    const payload = { deck_id: card.deckId, word_id: card.id, fields: merged, base };
    if (update) await outbox.put({ ...update, payload });
    else await outbox.add(op({ kind: 'card.update', deckId: card.deckId, wordId: card.id, payload }, now));
  }
  await tx.objectStore('cards').put({ ...card, ...fields, problem: undefined });
  await tx.done;
}

export async function removeCard(db: AccountDb, cardId: string, now = new Date()): Promise<void> {
  const tx = write(db);
  const card = await tx.objectStore('cards').get(cardId);
  if (!card) return tx.done;
  const pending = await unsent(tx, 'byWord', cardId);
  for (const item of pending) await tx.objectStore('outbox').delete(item.seq!);
  const sentBefore = card.version > 0 || (await tx.objectStore('outbox').index('byWord').count(cardId)) > 0;
  const madeHereOnly =
    pending.some((item) => item.kind === 'card.create') || (card.problem?.status === 'rejected' && card.version === 0);
  // A card the server never had needs nothing sent; any other goes away there too.
  if (sentBefore && !madeHereOnly) {
    await tx.objectStore('outbox').add(
      op(
        {
          kind: 'card.delete',
          deckId: card.deckId,
          wordId: card.id,
          payload: { deck_id: card.deckId, word_id: card.id },
        },
        now,
      ),
    );
  }
  await tx.objectStore('cards').delete(cardId);
  await tx.done;
}

export async function deleteDeck(db: AccountDb, deckId: string, now = new Date()): Promise<void> {
  const tx = write(db);
  const deck = await tx.objectStore('decks').get(deckId);
  if (!deck) return tx.done;
  const pending = await unsent(tx, 'byDeck', deckId);
  for (const item of pending) await tx.objectStore('outbox').delete(item.seq!);
  const madeHereOnly = pending.some((item) => item.kind === 'deck.create');
  const inFlight = (await tx.objectStore('outbox').index('byDeck').count(deckId)) > 0;
  if (!madeHereOnly || inFlight) {
    await tx.objectStore('outbox').add(op({ kind: 'deck.delete', deckId, payload: { deck_id: deckId } }, now));
  }
  for (const card of await tx.objectStore('cards').index('byDeck').getAll(deckId))
    await tx.objectStore('cards').delete(card.id);
  await tx.objectStore('decks').delete(deckId);
  await tx.done;
}

/** A conflict settled for my version: sent again, against what the server now has. */
export async function keepMine(db: AccountDb, cardId: string, now = new Date()): Promise<void> {
  const tx = write(db);
  const card = await tx.objectStore('cards').get(cardId);
  const conflicts = card?.problem?.conflicts;
  if (!card || !conflicts) return tx.done;
  const fields = Object.fromEntries(Object.entries(conflicts).map(([field, value]) => [field, value.mine]));
  const base = Object.fromEntries(Object.entries(conflicts).map(([field, value]) => [field, value.server]));
  await tx.objectStore('outbox').add(
    op(
      {
        kind: 'card.update',
        deckId: card.deckId,
        wordId: card.id,
        payload: { deck_id: card.deckId, word_id: card.id, fields, base },
      },
      now,
    ),
  );
  await tx.objectStore('cards').put({ ...card, ...fields, problem: undefined });
  await tx.done;
}

/** A conflict settled for the server's version. */
export async function takeServer(db: AccountDb, cardId: string): Promise<void> {
  const tx = write(db);
  const card = await tx.objectStore('cards').get(cardId);
  const conflicts = card?.problem?.conflicts;
  if (!card) return tx.done;
  const server = Object.fromEntries(Object.entries(conflicts ?? {}).map(([field, value]) => [field, value.server]));
  await tx.objectStore('cards').put({ ...card, ...server, problem: undefined });
  await tx.done;
}

// --- the server's answers ----------------------------------------------------------------------

export interface ServerCard {
  id: string;
  headword: string;
  pos: string;
  translation: string;
  example: string;
  example_translation: string;
  language: string;
  version: number;
  position: number;
  from_course: boolean;
}

export interface ServerDeck {
  id: string;
  title: string;
  language: string;
  status: string;
  version: number;
  created_at: string;
  reading_ref?: string | null;
  cards: ServerCard[];
}

export interface Pulled {
  cursor: number;
  full: boolean;
  decks: ServerDeck[];
  deleted_decks: string[];
  pulled_at: string;
}

export interface OpResult {
  op_id: string;
  status: 'applied' | 'duplicate' | 'conflict' | 'gone' | 'rejected';
  code?: string | null;
  conflicts?: Record<string, { mine: unknown; server: unknown }> | null;
  word_id?: string | null;
}

/**
 * What the server has, laid over this device's copy. A deck or card with a change waiting (or a
 * problem to settle) keeps this device's version until the change is answered; a deck deleted
 * elsewhere goes, with its waiting changes (deletion wins), and how many is remembered to be said.
 */
export async function applyPull(db: AccountDb, pulled: Pulled): Promise<void> {
  const tx = writeAll(db);
  const outbox = await tx.objectStore('outbox').getAll();
  const busyDecks = new Set(outbox.filter((item) => item.kind.startsWith('deck.')).map((item) => item.deckId));
  const decks = tx.objectStore('decks');
  const cards = tx.objectStore('cards');
  let lost = 0;

  const dropDeck = async (deckId: string) => {
    for (const item of outbox.filter((entry) => entry.deckId === deckId)) {
      if (item.kind !== 'deck.delete') lost += 1;
      await tx.objectStore('outbox').delete(item.seq!);
    }
    for (const card of await cards.index('byDeck').getAll(deckId)) await cards.delete(card.id);
    await decks.delete(deckId);
  };

  if (pulled.full) {
    const onServer = new Set(pulled.decks.map((deck) => deck.id));
    for (const deck of await decks.getAll()) {
      if (!onServer.has(deck.id) && !busyDecks.has(deck.id) && !deck.problem) await dropDeck(deck.id);
    }
  }
  for (const deckId of pulled.deleted_decks) await dropDeck(deckId);

  for (const server of pulled.decks) await layOver(tx, server, outbox);
  await tx.objectStore('sync').put({ key: 'decks', cursor: pulled.cursor, pulledAt: pulled.pulled_at });
  if (lost > 0) await addLost(tx, lost);
  await tx.done;
}

/** One deck from the server over this device's copy; see `applyPull`. */
async function layOver(tx: SyncTx, server: ServerDeck, outbox: OutboxOp[]) {
  const busyDecks = new Set(outbox.filter((item) => item.kind.startsWith('deck.')).map((item) => item.deckId));
  const busyCards = new Set(outbox.map((item) => item.wordId).filter(Boolean));
  const deletedHere = new Set(outbox.filter((item) => item.kind === 'deck.delete').map((item) => item.deckId));
  const cardsDeletedHere = new Set(outbox.filter((item) => item.kind === 'card.delete').map((item) => item.wordId));
  const decks = tx.objectStore('decks');
  const cards = tx.objectStore('cards');
  if (deletedHere.has(server.id)) return;
  const local = await decks.get(server.id);
  const keepTitle = busyDecks.has(server.id) || local?.problem;
  await decks.put({
    id: server.id,
    title: keepTitle && local ? local.title : server.title,
    language: server.language,
    status: server.status,
    version: server.version,
    createdAt: server.created_at,
    readingRef: server.reading_ref ?? local?.readingRef,
    problem: local?.problem,
  });
  const serverIds = new Set(server.cards.map((card) => card.id));
  for (const card of await cards.index('byDeck').getAll(server.id)) {
    if (!serverIds.has(card.id) && !busyCards.has(card.id) && !card.problem) await cards.delete(card.id);
  }
  for (const card of server.cards) {
    if (cardsDeletedHere.has(card.id)) continue;
    const mine = await cards.get(card.id);
    if (mine && (busyCards.has(card.id) || mine.problem)) {
      await cards.put({ ...mine, position: card.position, version: card.version, fromCourse: card.from_course });
      continue;
    }
    const { from_course, ...fields } = card;
    await cards.put({ ...fields, deckId: server.id, fromCourse: from_course });
  }
}

/**
 * The deck as the server just answered a change made there (cards drafted with AI, given to a
 * group): kept on this device at once, without waiting for the next pull.
 */
export async function rememberServerDeck(db: AccountDb, server: ServerDeck): Promise<void> {
  const tx = writeAll(db);
  if (await tx.objectStore('decks').get(server.id)) await layOver(tx, server, await tx.objectStore('outbox').getAll());
  await tx.done;
}

/** The server's answers to sent changes: done ones leave the outbox; the others mark the card or deck. */
export async function applyResults(db: AccountDb, sent: OutboxOp[], results: OpResult[]): Promise<void> {
  const tx = writeAll(db);
  const byId = new Map(results.map((result) => [result.op_id, result]));
  const outbox = tx.objectStore('outbox');
  const cards = tx.objectStore('cards');
  const decks = tx.objectStore('decks');
  for (const item of sent) {
    const result = byId.get(item.opId);
    if (!result) continue; // not answered: stays to be sent again
    await outbox.delete(item.seq!);
    if (item.kind === 'study.answer') {
      await settleAnswer(tx, item, result);
      continue;
    }
    if (item.kind === 'study.finish') continue;
    const problem: Problem | undefined =
      result.status === 'conflict'
        ? { status: 'conflict', conflicts: result.conflicts ?? {} }
        : result.status === 'rejected'
          ? { status: 'rejected', code: result.code ?? 'rejected' }
          : undefined;
    if (result.status === 'gone') {
      // Deleted elsewhere: deletion wins; the change is said to be lost.
      if (item.wordId) await cards.delete(item.wordId);
      else if (item.deckId && item.kind !== 'deck.delete') {
        for (const card of await cards.index('byDeck').getAll(item.deckId)) await cards.delete(card.id);
        await decks.delete(item.deckId);
      }
      await addLost(tx, 1);
    } else if (item.kind === 'me.update' && problem) {
      // A setting changed on another device meanwhile keeps that value: said, not dropped silently.
      await addLost(tx, 1);
    } else if (problem && item.wordId) {
      const card = await cards.get(item.wordId);
      if (card) await cards.put({ ...card, problem });
    } else if (problem && item.deckId && item.kind.startsWith('deck.')) {
      const deck = await decks.get(item.deckId);
      if (deck) await decks.put({ ...deck, problem });
    } else if (item.kind === 'card.create' && result.word_id && item.wordId) {
      await becameCourseWord(tx, item.wordId, result.word_id);
    } else if (item.wordId && (result.status === 'applied' || result.status === 'duplicate')) {
      const card = await cards.get(item.wordId);
      if (card && card.version === 0) await cards.put({ ...card, version: 1 });
    }
  }
  await tx.done;
}

/** A card that turned out to be a course word: it is that word now, here and in waiting changes. */
async function becameCourseWord(tx: SyncTx, from: string, to: string) {
  const cards = tx.objectStore('cards');
  const card = await cards.get(from);
  if (card) {
    await cards.delete(from);
    await cards.put({ ...card, id: to, fromCourse: true, version: 1 });
  }
  const outbox = tx.objectStore('outbox');
  for (const item of await outbox.index('byWord').getAll(from)) {
    await outbox.put({ ...item, wordId: to, payload: { ...item.payload, word_id: to } });
  }
}

/**
 * Changes lost to deletions elsewhere, and answers the server refused, since last said; reading
 * them clears them.
 */
export async function takeNotices(db: AccountDb): Promise<{ lost: number; refused: number }> {
  const tx = db.transaction('sync', 'readwrite');
  const notice = (await tx.store.get('notices')) as LostChanges | undefined;
  if (notice) await tx.store.delete('notices');
  await tx.done;
  return { lost: notice?.lost ?? 0, refused: notice?.refused ?? 0 };
}

export async function syncState(db: AccountDb): Promise<{ cursor: number; pulledAt: string | null }> {
  const state = (await db.get('sync', 'decks')) as SyncState | undefined;
  return { cursor: state?.cursor ?? 0, pulledAt: state?.pulledAt ?? null };
}
