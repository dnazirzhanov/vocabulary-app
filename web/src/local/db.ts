import { openDB, deleteDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { LocalLesson } from '../study/lessons.ts';
import type { LocalAnswer, Pack } from '../study/state.ts';

/**
 * What this device keeps (offline store). One database per account, named by the account's id, so
 * one person's decks and unsent changes are never opened for another (a shared family or school
 * phone). A small `slovar-meta` database remembers which account a sign-in belongs to, so the right
 * one opens without a connection. No passwords or tokens are kept here: the sign-in session stays
 * with Supabase's own client.
 *
 * Version history (each step is an upgrade below; never edit an old step, add a new one):
 *  1. snapshots: the last answer of a few screens, for opening them offline.
 *  2. my decks and cards, the outbox of changes not yet sent, and the sync's own state (ADR 0061).
 *  3. studying on the device (ADR 0062): the study pack, lessons, and answers given since the pack.
 */
export const LOCAL_VERSION = 3;

/** A screen's last answer from the server, kept to show it without a connection. */
export interface Snapshot<T = unknown> {
  key: string;
  value: T;
  savedAt: string;
}

/** What went wrong with a change the server didn't take as it was, shown on the deck or card. */
export interface Problem {
  status: 'conflict' | 'rejected' | 'gone';
  /** rejected: the API's code (word_in_deck, deck_full…). */
  code?: string;
  /** conflict: each field changed elsewhere, with both values. */
  conflicts?: Record<string, { mine: unknown; server: unknown }>;
}

/** One of my decks as this device has it. */
export interface LocalDeck {
  id: string;
  title: string;
  language: string;
  status: string;
  version: number;
  createdAt: string;
  /** The reading it was made from (`library:<article id>`), set once, when made. */
  readingRef?: string;
  problem?: Problem;
}

/** A card of one of my decks; `fromCourse`: a course word linked in, not this deck's to edit. */
export interface LocalCard {
  id: string;
  deckId: string;
  headword: string;
  pos: string;
  translation: string;
  example: string;
  example_translation: string;
  language: string;
  version: number;
  position: number;
  fromCourse: boolean;
  problem?: Problem;
}

export type OpKind =
  | 'deck.create'
  | 'deck.rename'
  | 'deck.delete'
  | 'card.create'
  | 'card.update'
  | 'card.delete'
  | 'me.update'
  | 'pace.extra'
  | 'card.report'
  | 'reading.answer'
  | 'study.answer'
  | 'study.finish';

/**
 * A change made on this device, waiting for the server. `seq` keeps them in the order made;
 * `opId` is sent with every retry, so the server applies it once.
 */
export interface OutboxOp {
  seq?: number;
  opId: string;
  kind: OpKind;
  /** The deck it belongs to (none for settings): deleting a deck drops its unsent changes. */
  deckId?: string;
  /** The card it changes. */
  wordId?: string;
  /** The operation as the server takes it, without `op_id`. */
  payload: Record<string, unknown>;
  createdAt: string;
  /** pending: may still be merged with later changes; sending: in a request, left as it is. */
  status: 'pending' | 'sending';
  attempts: number;
  lastError?: string;
}

export interface SyncState {
  key: 'decks';
  cursor: number;
  pulledAt: string | null;
}

/**
 * Changes lost to deletions made elsewhere, and answers the server refused (ADR 0062), not yet
 * said: never in silence.
 */
export interface LostChanges {
  key: 'notices';
  lost: number;
  refused?: number;
}

/** The last study pack, with its tag; and this device's id, sent with its answers. */
export type StudyRecord =
  { key: 'pack'; pack: Pack; etag: string | null; fetchedAt: string } | { key: 'device'; id: string };

/**
 * An answer given here, kept until a pack that includes it arrives: until then it is applied on
 * top of the pack. `acked`: the server took it (the next pack has it).
 */
export interface KeptAnswer {
  opId: string;
  seq?: number;
  answer: LocalAnswer;
  acked: boolean;
}

export interface AccountSchema extends DBSchema {
  snapshots: { key: string; value: Snapshot };
  decks: { key: string; value: LocalDeck };
  cards: { key: string; value: LocalCard; indexes: { byDeck: string } };
  outbox: { key: number; value: OutboxOp; indexes: { byDeck: string; byWord: string } };
  sync: { key: string; value: SyncState | LostChanges };
  study: { key: string; value: StudyRecord };
  answers: { key: number; value: KeptAnswer; indexes: { byOp: string } };
  lessons: { key: string; value: LocalLesson };
}

interface MetaSchema extends DBSchema {
  /** A sign-in (auth subject, or `dev`) and the account it is, from the last answer of /api/me. */
  accounts: { key: string; value: { subject: string; accountId: string; seenAt: string } };
}

export type AccountDb = IDBPDatabase<AccountSchema>;

const META = 'slovar-meta';
export const accountDbName = (accountId: string) => `slovar-${accountId}`;

/** False where the browser has no IndexedDB (or refuses it): the app then works online only. */
export const localSupported = () => typeof indexedDB !== 'undefined';

function openMeta() {
  return openDB<MetaSchema>(META, 1, {
    upgrade(db) {
      db.createObjectStore('accounts', { keyPath: 'subject' });
    },
  });
}

export function openAccountDb(accountId: string): Promise<AccountDb> {
  let opened: AccountDb | undefined;
  const db = openDB<AccountSchema>(accountDbName(accountId), LOCAL_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) db.createObjectStore('snapshots', { keyPath: 'key' });
      if (oldVersion < 2) {
        db.createObjectStore('decks', { keyPath: 'id' });
        db.createObjectStore('cards', { keyPath: 'id' }).createIndex('byDeck', 'deckId');
        const outbox = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
        outbox.createIndex('byDeck', 'deckId');
        outbox.createIndex('byWord', 'wordId');
        db.createObjectStore('sync', { keyPath: 'key' });
      }
      if (oldVersion < 3) {
        db.createObjectStore('study', { keyPath: 'key' });
        db.createObjectStore('answers', { keyPath: 'seq', autoIncrement: true }).createIndex('byOp', 'opId', {
          unique: true,
        });
        db.createObjectStore('lessons', { keyPath: 'id' });
      }
    },
    // Another tab wants a newer version: this one reloads into that code. Deleted (the account
    // was): this connection just closes, so the deletion goes through and nothing reloads.
    blocking(_current, wanted) {
      if (wanted === null) opened?.close();
      else location.reload();
    },
  });
  return db.then((ready) => (opened = ready));
}

/** The account a sign-in was last seen as, or null if this device has never seen it online. */
export async function accountFor(subject: string): Promise<string | null> {
  const meta = await openMeta();
  try {
    return (await meta.get('accounts', subject))?.accountId ?? null;
  } finally {
    meta.close();
  }
}

export async function rememberAccount(subject: string, accountId: string, now = new Date()) {
  const meta = await openMeta();
  try {
    await meta.put('accounts', { subject, accountId, seenAt: now.toISOString() });
  } finally {
    meta.close();
  }
}

/** After the account itself is deleted: nothing of it stays on this device. */
export async function forgetAccount(subject: string, accountId: string) {
  const meta = await openMeta();
  try {
    await meta.delete('accounts', subject);
  } finally {
    meta.close();
  }
  await deleteDB(accountDbName(accountId));
}

export async function saveSnapshot<T>(db: AccountDb, key: string, value: T, now = new Date()) {
  await db.put('snapshots', { key, value, savedAt: now.toISOString() });
}

export async function readSnapshot<T>(db: AccountDb, key: string): Promise<Snapshot<T> | null> {
  return ((await db.get('snapshots', key)) as Snapshot<T> | undefined) ?? null;
}
