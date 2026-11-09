import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANSWERS_PER_PUSH, nextBatch } from './batch.ts';
import type { OutboxOp } from './db.ts';

const op = (kind: OutboxOp['kind'], n: number): OutboxOp => ({
  opId: `${kind}-${n}`,
  kind,
  payload: {},
  createdAt: 'x',
  status: 'pending',
  attempts: 0,
});

test('a request carries at most ten answers, in order, with what came before them', () => {
  const waiting = [
    op('deck.create', 0),
    ...Array.from({ length: 25 }, (_, n) => op('study.answer', n)),
    op('study.finish', 0),
  ];
  const first = nextBatch(waiting);
  assert.equal(first.length, 1 + ANSWERS_PER_PUSH);
  assert.deepEqual(first.map((item) => item.opId).slice(0, 2), ['deck.create-0', 'study.answer-0']);
  assert.equal(nextBatch(waiting.slice(first.length)).length, ANSWERS_PER_PUSH);
  // The last answers go with the lesson's end.
  assert.deepEqual(
    nextBatch(waiting.slice(21)).map((item) => item.kind),
    ['study.answer', 'study.answer', 'study.answer', 'study.answer', 'study.answer', 'study.finish'],
  );
  // Other changes are not held back by the answers' limit.
  assert.equal(nextBatch(Array.from({ length: 250 }, (_, n) => op('card.create', n))).length, 200);
});
