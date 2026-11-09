import type { OutboxOp } from './db.ts';

/** At most this many operations in one request (the server's limit, ADR 0061). */
const BATCH = 200;
// Answers are re-applied one by one with the full rules (ADR 0062): a lesson's worth in one request
// took over 30 s on the free server's share of a CPU (docs/research/capacity-device-2026-11.md),
// so a request carries at most this many.
export const ANSWERS_PER_PUSH = 10;

/** The next ops to send, in order: up to BATCH, and no more than ANSWERS_PER_PUSH answers. */
export function nextBatch(waiting: OutboxOp[]): OutboxOp[] {
  const batch: OutboxOp[] = [];
  let answers = 0;
  for (const item of waiting.slice(0, BATCH)) {
    if (item.kind === 'study.answer') {
      if (answers === ANSWERS_PER_PUSH) break;
      answers += 1;
    }
    batch.push(item);
  }
  return batch;
}
