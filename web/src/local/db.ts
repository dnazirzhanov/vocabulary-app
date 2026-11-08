import { openDB, deleteDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * What this device keeps (offline store). One database per account, named by the account's id, so
 * one person's decks and unsent changes are never opened for another (a shared family or school
 * phone). A small `slovar-meta` database remembers which account a sign-in belongs to, so the right
 * one opens without a connection. No passwords or tokens are kept here: the sign-in session stays
 * with Supabase's own client.
 *
 * Version history (each step is an upgrade below; never edit an old step, add a new one):
 *  1. snapshots: the last answer of a few screens, for opening them offline.
 */
export const LOCAL_VERSION = 1;

/** A screen's last answer from the server, kept to show it without a connection. */
export interface Snapshot<T = unknown> {
  key: string;
  value: T;
  savedAt: string;
}

export interface AccountSchema extends DBSchema {
  snapshots: { key: string; value: Snapshot };
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
