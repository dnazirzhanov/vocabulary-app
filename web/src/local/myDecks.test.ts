import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDB } from 'idb';
import { accountDbName, openAccountDb, type AccountDb, type OutboxOp } from './db.ts';
import {
  addCard,
  applyPull,
  applyResults,
  createDeck,
  deckCards,
  deleteDeck,
  editCard,
  keepMine,
  LocalError,
  removeCard,
  renameDeck,
  syncState,
  takeNotices,
  type CardInput,
  type Pulled,
} from './myDecks.ts';

const fresh = () => openAccountDb(`test-${crypto.randomUUID()}`);
const card = (headword: string, translation = 'перевод'): CardInput => ({
  headword,
  pos: 'noun',
  translation,
  example: `A ${headword}.`,
  example_translation: '',
  language: 'ru',
});
const ops = (db: AccountDb) => db.getAll('outbox');
const word = (n: number) => `word${String.fromCharCode(97 + Math.floor(n / 26))}${String.fromCharCode(97 + (n % 26))}`;
/** The server took everything sent: as the sync would mark it. */
async function sendAll(db: AccountDb) {
  const sent = await ops(db);
  await applyResults(
    db,
    sent,
    sent.map((item) => ({ op_id: item.opId, status: 'applied' as const })),
  );
}

test('a deck and twenty cards made offline: kept in order, with one operation each', async () => {
  const db = await fresh();
  const deck = await createDeck(db, '  Поездки ', 'ru');
  for (let n = 0; n < 20; n += 1) await addCard(db, deck.id, card(word(n)));
  const cards = await deckCards(db, deck.id);
  assert.deepEqual(
    cards.map((item) => item.position),
    Array.from({ length: 20 }, (_, n) => n + 1),
  );
  const queued = await ops(db);
  assert.equal(queued.length, 21);
  assert.equal(queued[0].kind, 'deck.create');
  assert.equal(queued[0].payload.title, 'Поездки');
  assert.ok(queued.every((item, n) => n === 0 || item.kind === 'card.create'));
  assert.equal(new Set(queued.map((item) => item.opId)).size, 21);
  assert.match(deck.id, /^g-[0-9a-f-]{36}$/);
  assert.match(cards[0].id, /^t-[0-9a-f-]{36}$/);
  db.close();
});

test('the server rules are checked here first', async () => {
  const db = await fresh();
  const deck = await createDeck(db, 'Слова', 'ru');
  await addCard(db, deck.id, card('apple'));
  await assert.rejects(addCard(db, deck.id, card('Apple')), (error: LocalError) => error.code === 'word_in_deck');
  await assert.rejects(addCard(db, deck.id, card('apple2')), (error: LocalError) => error.code === 'invalid_request');
  await assert.rejects(addCard(db, deck.id, { ...card('pear'), translation: ' ' }), LocalError);
  await assert.rejects(createDeck(db, 'x', 'ru'), LocalError);
  db.close();
});

test('unsent changes are merged, and what was never sent is never sent', async () => {
  const db = await fresh();
  const deck = await createDeck(db, 'Слова', 'ru');
  const apple = await addCard(db, deck.id, card('apple', 'яблоко'));
  await editCard(db, apple.id, card('apple', 'яблочко'));
  await renameDeck(db, deck.id, 'Фрукты');
  const queued = await ops(db);
  assert.deepEqual(
    queued.map((item) => item.kind),
    ['deck.create', 'card.create'],
  );
  assert.equal(queued[0].payload.title, 'Фрукты');
  assert.equal((queued[1].payload.card as CardInput).translation, 'яблочко');

  // Made and deleted before anything went: nothing at all.
  const pear = await addCard(db, deck.id, card('pear'));
  await removeCard(db, pear.id);
  assert.equal((await ops(db)).length, 2);
  await deleteDeck(db, deck.id);
  assert.deepEqual(await ops(db), []);
  db.close();
});

test('edits of a card the server has become one edit, against what it had', async () => {
  const db = await fresh();
  const deck = await createDeck(db, 'Слова', 'ru');
  const apple = await addCard(db, deck.id, card('apple', 'яблоко'));
  await sendAll(db);
  await editCard(db, apple.id, card('apple', 'яблочко'));
  await editCard(db, apple.id, { ...card('apple', 'яблоня'), example: 'An apple tree.' });
  const [update] = await ops(db);
  assert.equal(update.kind, 'card.update');
  assert.deepEqual(update.payload.fields, { translation: 'яблоня', example: 'An apple tree.' });
  assert.deepEqual(update.payload.base, { translation: 'яблоко', example: 'A apple.' });
  // Deleted after all: the edit is dropped, the deletion sent.
  await removeCard(db, apple.id);
  assert.deepEqual(
    (await ops(db)).map((item) => item.kind),
    ['card.delete'],
  );
  db.close();
});

test('changes already on their way are never merged into', async () => {
  const db = await fresh();
  const deck = await createDeck(db, 'Слова', 'ru');
  const apple = await addCard(db, deck.id, card('apple', 'яблоко'));
  const sending = await ops(db);
  for (const item of sending) await db.put('outbox', { ...item, status: 'sending' } satisfies OutboxOp);
  await editCard(db, apple.id, card('apple', 'яблочко'));
  const queued = await ops(db);
  assert.equal(queued.length, 3);
  assert.equal((queued[1].payload.card as CardInput).translation, 'яблоко');
  assert.equal(queued[2].kind, 'card.update');
  db.close();
});

test('a card that is a course word becomes it, in the waiting changes too', async () => {
  const db = await fresh();
  const deck = await createDeck(db, 'Дом', 'ru');
  const house = await addCard(db, deck.id, card('house', 'дом'));
  const [create, made] = await ops(db);
  await applyResults(
    db,
    [create, made],
    [
      { op_id: create.opId, status: 'applied' },
      { op_id: made.opId, status: 'applied', word_id: 'house' },
    ],
  );
  const [linked] = await deckCards(db, deck.id);
  assert.equal(linked.id, 'house');
  assert.equal(linked.fromCourse, true);
  assert.equal(await db.get('cards', house.id), undefined);
  await assert.rejects(
    editCard(db, 'house', card('house', 'жильё')),
    (error: LocalError) => error.code === 'course_word',
  );
  db.close();
});

test('a conflict marks the card, and keeping mine sends it against the server value', async () => {
  const db = await fresh();
  const deck = await createDeck(db, 'Слова', 'ru');
  const apple = await addCard(db, deck.id, card('apple', 'яблоко'));
  await sendAll(db);
  await editCard(db, apple.id, card('apple', 'ноутбук'));
  const [update] = await ops(db);
  await applyResults(
    db,
    [update],
    [{ op_id: update.opId, status: 'conflict', conflicts: { translation: { mine: 'ноутбук', server: 'телефон' } } }],
  );
  assert.equal((await db.get('cards', apple.id))?.problem?.status, 'conflict');
  await keepMine(db, apple.id);
  const [again] = await ops(db);
  assert.deepEqual(again.payload.fields, { translation: 'ноутбук' });
  assert.deepEqual(again.payload.base, { translation: 'телефон' });
  assert.equal((await db.get('cards', apple.id))?.problem, undefined);
  db.close();
});

const pulled = (fields: Partial<Pulled>): Pulled => ({
  cursor: 10,
  full: false,
  decks: [],
  deleted_decks: [],
  pulled_at: '2026-11-08T09:00:00Z',
  ...fields,
});
const serverCard = (id: string, headword: string, position: number, translation = 'перевод') => ({
  id,
  headword,
  pos: 'noun',
  translation,
  example: `A ${headword}.`,
  example_translation: '',
  language: 'ru',
  version: 2,
  position,
  from_course: false,
});

test("the server's decks are laid over this device's, never over waiting changes", async () => {
  const db = await fresh();
  const deck = await createDeck(db, 'Слова', 'ru');
  const apple = await addCard(db, deck.id, card('apple', 'яблоко'));
  const gone = await addCard(db, deck.id, card('pear'));
  await sendAll(db);
  await editCard(db, apple.id, card('apple', 'моё'));
  await applyPull(
    db,
    pulled({
      decks: [
        {
          id: deck.id,
          title: 'Переименована',
          language: 'ru',
          status: 'draft',
          version: 2,
          created_at: '2026-11-08T08:00:00Z',
          // The pear was removed on another device; a plum added there.
          cards: [serverCard(apple.id, 'apple', 1, 'чужое'), serverCard('t-other', 'plum', 3)],
        },
      ],
    }),
  );
  const cards = await deckCards(db, deck.id);
  assert.deepEqual(
    cards.map((item) => [item.headword, item.translation]),
    [
      ['apple', 'моё'],
      ['plum', 'перевод'],
    ],
  );
  assert.equal(await db.get('cards', gone.id), undefined);
  assert.equal((await db.get('decks', deck.id))?.title, 'Переименована');
  db.close();
});

test('a deck deleted elsewhere goes with its waiting changes, and they are counted to be said', async () => {
  const db = await fresh();
  const deck = await createDeck(db, 'Слова', 'ru');
  await addCard(db, deck.id, card('apple'));
  await sendAll(db);
  await addCard(db, deck.id, card('pear'));
  await applyPull(db, pulled({ deleted_decks: [deck.id] }));
  assert.equal(await db.get('decks', deck.id), undefined);
  assert.deepEqual(await deckCards(db, deck.id), []);
  assert.deepEqual(await ops(db), []);
  assert.deepEqual(await takeNotices(db), { lost: 1, refused: 0 });
  assert.deepEqual(await takeNotices(db), { lost: 0, refused: 0 });
  db.close();
});

test('a database from before decks were kept is upgraded with its screens', async () => {
  const name = `old-${crypto.randomUUID()}`;
  const old = await openDB(accountDbName(name), 1, {
    upgrade(db) {
      db.createObjectStore('snapshots', { keyPath: 'key' });
    },
  });
  await old.put('snapshots', { key: 'me', value: { name: 'Анна' }, savedAt: 'x' });
  old.close();
  const db = await openAccountDb(name);
  assert.deepEqual((await db.get('snapshots', 'me'))?.value, { name: 'Анна' });
  assert.deepEqual([...db.objectStoreNames].sort(), [
    'answers',
    'cards',
    'decks',
    'lessons',
    'outbox',
    'snapshots',
    'study',
    'sync',
  ]);
  db.close();
});

test('a database from before studying on the device keeps its decks and unsent changes (ADR 0062)', async () => {
  const name = `v2-${crypto.randomUUID()}`;
  const old = await openDB(accountDbName(name), 2, {
    upgrade(db) {
      db.createObjectStore('snapshots', { keyPath: 'key' });
      db.createObjectStore('decks', { keyPath: 'id' });
      db.createObjectStore('cards', { keyPath: 'id' }).createIndex('byDeck', 'deckId');
      const outbox = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      outbox.createIndex('byDeck', 'deckId');
      outbox.createIndex('byWord', 'wordId');
      db.createObjectStore('sync', { keyPath: 'key' });
    },
  });
  await old.put('decks', { id: 'g-1', title: 'Мои', language: 'ru', status: 'draft', version: 1, createdAt: 'x' });
  await old.add('outbox', {
    opId: 'op-1',
    kind: 'deck.rename',
    deckId: 'g-1',
    payload: { deck_id: 'g-1', title: 'Мои', base_title: 'Old' },
    createdAt: 'x',
    status: 'pending',
    attempts: 0,
  });
  await old.put('sync', { key: 'decks', cursor: 7, pulledAt: 'y' });
  old.close();
  const db = await openAccountDb(name);
  assert.equal(db.version, 3);
  assert.equal((await db.get('decks', 'g-1'))?.title, 'Мои');
  assert.deepEqual(
    (await db.getAll('outbox')).map((item) => item.opId),
    ['op-1'],
  );
  assert.equal((await syncState(db)).cursor, 7);
  assert.deepEqual(await db.getAll('lessons'), []);
  assert.deepEqual(await db.getAll('answers'), []);
  assert.equal(await db.get('study', 'pack'), undefined);
  db.close();
});

test("the server's answers on study answers: taken ones wait for the pack, refused ones go and are said, unanswered ones stay (ADR 0062)", async () => {
  const db = await fresh();
  const studied = (opId: string, exerciseId: string) => ({
    opId,
    answer: {
      opId,
      sessionId: 'lesson-1',
      sessionKind: 'study' as const,
      deckId: 'a1-a2',
      exerciseId,
      wordId: exerciseId,
      new: true,
      hint: null,
      rating: 3 as const,
      answer: null,
      heard: false,
      answeredAt: 0,
    },
    acked: false,
  });
  for (const [opId, exerciseId] of [
    ['op-1', 'c1'],
    ['op-2', 'c2'],
    ['op-3', 'c3'],
  ]) {
    await db.add('answers', studied(opId, exerciseId));
    // As the device puts them: no deck or card in the outbox's indexes.
    await db.add('outbox', {
      opId,
      kind: 'study.answer',
      payload: { exercise_id: exerciseId },
      createdAt: 'x',
      status: 'sending',
      attempts: 0,
    });
  }
  // The connection broke before the third was answered.
  await applyResults(db, await ops(db), [
    { op_id: 'op-1', status: 'applied' },
    { op_id: 'op-2', status: 'rejected', code: 'before_last_contact' },
  ]);
  const kept = await db.getAll('answers');
  assert.deepEqual(
    kept.map((item) => [item.opId, item.acked]),
    [
      ['op-1', true],
      ['op-3', false],
    ],
  );
  assert.deepEqual(
    (await ops(db)).map((item) => item.opId),
    ['op-3'],
  );
  assert.deepEqual(await takeNotices(db), { lost: 0, refused: 1 });
  db.close();
});
