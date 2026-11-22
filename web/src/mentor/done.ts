/**
 * Done-today tracking for the mentor plan. Same shape as `reading-progress:<account>`: a per-
 * account localStorage entry, scoped to the local calendar day so it clears at midnight.
 *
 * A task moves `launched → done` only when the backend confirms it's gone from the active plan
 * (no "optimistic done": if the learner bails out mid-session, the deck is still partially due
 * and the task shows up again).
 */

import type { PlanItem } from './types.ts';

interface DoneEntry {
  key: string;
  item: PlanItem;
  at: string; // ISO timestamp
}

interface DoneStore {
  /** Local calendar day the store was written on. Store is reset when this is not today. */
  date: string;
  /** Tasks the learner tapped Start on but hasn't been confirmed completed yet. */
  launched: DoneEntry[];
  /** Tasks confirmed completed (no longer appear in the active plan). */
  done: DoneEntry[];
}

const storageKey = (account: string) => `mentor-done:${account}`;

function todayLocal(): string {
  const d = new Date();
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function empty(): DoneStore {
  return { date: todayLocal(), launched: [], done: [] };
}

function read(account: string): DoneStore {
  try {
    const raw = localStorage.getItem(storageKey(account));
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as DoneStore;
    if (parsed.date !== todayLocal()) return empty();
    return parsed;
  } catch {
    return empty();
  }
}

function write(account: string, store: DoneStore): void {
  try {
    localStorage.setItem(storageKey(account), JSON.stringify(store));
  } catch {
    // private mode or quota: tracking lasts for this visit only
  }
}

/** Record a task that the learner tapped Start on. Idempotent on the item's key. */
export function markLaunched(account: string, item: PlanItem, key: string): void {
  const store = read(account);
  if (store.launched.some((e) => e.key === key) || store.done.some((e) => e.key === key)) {
    return;
  }
  store.launched.push({ key, item, at: new Date().toISOString() });
  write(account, store);
}

/**
 * Reconcile `launched` entries against the current active plan:
 * - entry no longer in active plan → moved to `done` (learner completed it);
 * - entry still in active plan → left pending (dropped only once it eventually leaves active).
 *
 * Returns the list of currently-done PlanItems (newest first), to render below the active list.
 */
export function reconcileDone(account: string, activeKeys: ReadonlySet<string>): PlanItem[] {
  const store = read(account);
  const stillLaunched: DoneEntry[] = [];
  let changed = false;
  for (const entry of store.launched) {
    if (activeKeys.has(entry.key)) {
      stillLaunched.push(entry);
    } else if (!store.done.some((d) => d.key === entry.key)) {
      store.done.push({ key: entry.key, item: entry.item, at: new Date().toISOString() });
      changed = true;
    }
  }
  if (stillLaunched.length !== store.launched.length) {
    store.launched = stillLaunched;
    changed = true;
  }
  if (changed) write(account, store);
  return [...store.done].reverse().map((e) => e.item);
}
