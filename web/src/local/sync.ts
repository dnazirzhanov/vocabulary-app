import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.ts';
import type { AccountDb, OutboxOp } from './db.ts';
import { keepAudioAhead, refreshPack, takePackWanted } from '../study/device.ts';
import { applyPull, applyResults, syncState } from './myDecks.ts';
import { localDb } from './session.ts';

/**
 * Sends this device's changes (decks, settings, answers) and brings the server's (ADR 0061,
 * 0062): my decks, then the study pack. Runs when the app opens, when
 * the connection comes back, when the app is looked at again, and a moment after each change.
 * One tab at a time (a browser lock); the server applies each change once anyway. A change the
 * server can't be reached for stays, and is sent next time: nothing is dropped for want of a
 * connection or an expired sign-in.
 */

const BATCH = 200;
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

/** Something on this device changed (a local edit, or the server's answer): screens redraw. */
export function localChanged() {
  for (const listener of listeners) listener();
}

/** A number that changes whenever this device's decks do, to reload from the store. */
export function useLocalVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((value) => value + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  return version;
}

/** After a local change: soon, so several quick ones go together. */
export function syncSoon(delay = 1000) {
  localChanged();
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

export function syncNow(): Promise<void> {
  const db = localDb();
  if (!db) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  const work = () => cycle(db);
  running = (navigator.locks ? navigator.locks.request(`sync-${db.name}`, work) : work())
    .catch(() => undefined)
    .finally(() => {
      running = null;
      localChanged();
      if (again) {
        again = false;
        void syncNow();
      }
    });
  return running;
}

const wire = (item: OutboxOp) => ({ op_id: item.opId, kind: item.kind, ...item.payload });

async function pullFrom(db: AccountDb, fromScratch = false) {
  const state = await syncState(db);
  const cursor = fromScratch ? 0 : state.cursor;
  await applyPull(db, await api.syncPull(cursor, fromScratch ? null : state.pulledAt));
}

async function mark(db: AccountDb, batch: OutboxOp[], status: OutboxOp['status'], error?: string) {
  const tx = db.transaction('outbox', 'readwrite');
  for (const item of batch) {
    const current = await tx.store.get(item.seq!);
    if (!current) continue;
    await tx.store.put({
      ...current,
      status,
      attempts: current.attempts + (error ? 1 : 0),
      ...(error ? { lastError: error } : {}),
    });
  }
  await tx.done;
}

async function cycle(db: AccountDb) {
  // First time on this device: everything of mine, before sending anything against it.
  if (!(await syncState(db)).pulledAt) await pullFrom(db, true);
  let finished = false;
  for (;;) {
    // In order made; one left "sending" by a closed app is simply sent again.
    const batch = (await db.getAll('outbox')).slice(0, BATCH);
    if (batch.length === 0) break;
    await mark(db, batch, 'sending');
    let results;
    try {
      results = (await api.syncPush(batch.map(wire), (await syncState(db)).pulledAt)).results;
    } catch (error) {
      await mark(db, batch, 'pending', error instanceof Error ? error.message : 'error');
      // Away longer than deletions are remembered: everything again, then the changes.
      if (error instanceof ApiError && error.code === 'resync_required') {
        await pullFrom(db, true);
        continue;
      }
      throw error; // no connection, signed out: they wait for next time
    }
    await applyResults(db, batch, results);
    finished ||= batch.some((item) => item.kind === 'study.finish');
  }
  await pullFrom(db);
  // With every change of this device in, the study pack holds them all (ADR 0062); it is also
  // this device's contact with the server. Then the week's recordings, quietly.
  await refreshPack(db, finished || takePackWanted());
  void keepAudioAhead(db).catch(() => 0);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
}
