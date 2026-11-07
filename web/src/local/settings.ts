import { api, ApiError } from '../lib/api.ts';
import type { Me, MeUpdate } from '../lib/types.ts';
import { readSnapshot, saveSnapshot, type OutboxOp } from './db.ts';
import { localDb } from './session.ts';
import { syncSoon } from './sync.ts';

/**
 * A setting saved (ADR 0061): on the server when it can be reached; otherwise on this device at
 * once, and sent later with the value it replaced, so a change made on another device meanwhile
 * isn't overwritten. The promise and its pause aren't here: they change online only.
 */
export async function saveMe(fields: MeUpdate): Promise<Me> {
  const db = localDb();
  try {
    const me = await api.updateMe(fields);
    if (db) await saveSnapshot(db, 'me', me).catch(() => null);
    return me;
  } catch (error) {
    if (!(error instanceof ApiError) || error.kind !== 'network' || !db) throw error;
    const kept = (await readSnapshot<Me>(db, 'me'))?.value;
    if (!kept) throw error;
    const changed = Object.fromEntries(
      Object.entries(fields).filter(([field, value]) => kept[field as keyof Me] !== value),
    );
    const base = Object.fromEntries(Object.keys(changed).map((field) => [field, kept[field as keyof Me]]));
    const tx = db.transaction(['outbox', 'snapshots'], 'readwrite');
    const waiting = (await tx.objectStore('outbox').getAll()).find(
      (item) => item.kind === 'me.update' && item.status === 'pending',
    );
    if (waiting) {
      // One change of settings: the newest values, against what the server had before the first.
      const payload = waiting.payload as { fields: Record<string, unknown>; base: Record<string, unknown> };
      await tx.objectStore('outbox').put({
        ...waiting,
        payload: { fields: { ...payload.fields, ...changed }, base: { ...base, ...payload.base } },
      });
    } else if (Object.keys(changed).length > 0) {
      const item: OutboxOp = {
        opId: crypto.randomUUID(),
        kind: 'me.update',
        payload: { fields: changed, base },
        createdAt: new Date().toISOString(),
        status: 'pending',
        attempts: 0,
      };
      await tx.objectStore('outbox').add(item);
    }
    const me = { ...kept, ...changed } as Me;
    await tx.objectStore('snapshots').put({ key: 'me', value: me, savedAt: new Date().toISOString() });
    await tx.done;
    syncSoon();
    return me;
  }
}
