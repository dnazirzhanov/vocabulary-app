import { ApiError } from '../lib/api.ts';
import {
  accountFor,
  forgetAccount,
  localSupported,
  openAccountDb,
  readSnapshot,
  rememberAccount,
  saveSnapshot,
  type AccountDb,
} from './db.ts';

/**
 * The signed-in account's store on this device, open while that account is. Opened from the last
 * account this sign-in was seen as, so it works offline; confirmed (or switched) by /api/me.
 */
let open: { subject: string; accountId: string; db: Promise<AccountDb | null> } | null = null;

/**
 * The account's store, opened once: callers at the same moment (the app loading twice, a retry)
 * share one connection, so none is left open behind the app's back.
 */
function openFor(subject: string, accountId: string): Promise<AccountDb | null> {
  if (open?.subject === subject && open.accountId === accountId) return open.db;
  closeLocal();
  // Private browsing, storage turned off: null, and the app works online only.
  const db = openAccountDb(accountId).catch(() => null);
  open = { subject, accountId, db };
  void db.then((opened) => {
    if (open?.db === db) current = opened;
  });
  return db;
}

/** Opens what this device kept for a sign-in, if it has ever been online with it. */
export async function openLocal(subject: string): Promise<AccountDb | null> {
  if (!localSupported()) return null;
  const accountId = await accountFor(subject).catch(() => null);
  return accountId ? openFor(subject, accountId) : null;
}

/** The server named the account: keep this device's data under it, and ask the browser to keep it. */
export async function bindAccount(subject: string, accountId: string): Promise<AccountDb | null> {
  if (!localSupported()) return null;
  await rememberAccount(subject, accountId).catch(() => null);
  // Kept unless the person clears it; browsers may still evict it under pressure (iOS especially).
  void navigator.storage?.persist?.().catch(() => false);
  return openFor(subject, accountId);
}

/** Signing out: closed, never deleted, so nothing unsent is lost; it reopens at the next sign-in. */
export function closeLocal() {
  void open?.db.then((db) => db?.close());
  open = null;
  current = null;
}

/**
 * The account is gone: a way to delete everything this device kept of it, taken before signing
 * out (which closes the store), and run after, once nothing on the page can use it.
 */
export function localForgetter(): () => Promise<void> {
  const gone = open && { subject: open.subject, accountId: open.accountId };
  return async () => {
    if (gone) await forgetAccount(gone.subject, gone.accountId).catch(() => null);
  };
}

// The open store once its opening is done, for code that needs it at once.
let current: AccountDb | null = null;
export const localDb = () => current;

/** A screen's data and whether it came from this device because the server couldn't be reached. */
export interface Loaded<T> {
  value: T;
  offline: boolean;
}

/**
 * The server's answer, kept for next time; without a connection, the last one kept. Only for
 * screens chosen to work offline: nothing is cached by default.
 */
export async function withSnapshot<T>(key: string, fetch: () => Promise<T>): Promise<Loaded<T>> {
  try {
    const value = await fetch();
    const db = localDb();
    if (db) await saveSnapshot(db, key, value).catch(() => null); // a full disk only loses the copy
    return { value, offline: false };
  } catch (error) {
    const db = localDb();
    if (!(error instanceof ApiError) || error.kind !== 'network' || !db) throw error;
    const kept = await readSnapshot<T>(db, key).catch(() => null);
    if (!kept) throw error;
    return { value: kept.value, offline: true };
  }
}
