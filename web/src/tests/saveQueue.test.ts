import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SaveQueue, StopSaving, type Save } from './saveQueue.ts';

/** A save whose result the test decides, one call at a time. */
function server() {
  const calls: Save[] = [];
  const pending: { resolve: () => void; reject: (e: Error) => void }[] = [];
  const save = (item: Save) =>
    new Promise<void>((resolve, reject) => {
      calls.push(item);
      pending.push({ resolve, reject });
    });
  const settle = async (how: 'ok' | 'fail' | 'stop') => {
    const next = pending.shift()!;
    if (how === 'ok') next.resolve();
    else next.reject(how === 'stop' ? new StopSaving() : new Error('offline'));
    await new Promise((r) => setTimeout(r, 0));
  };
  return { calls, save, settle };
}

const noWait = () => Promise.resolve();

test('saves go one at a time, in order', async () => {
  const s = server();
  const queue = new SaveQueue(s.save, () => undefined, noWait);
  queue.push({ key: 'a', answer: 'cat' });
  queue.push({ key: 'b', answer: null });
  assert.deepEqual(s.calls, [{ key: 'a', answer: 'cat' }]); // b waits for a
  await s.settle('ok');
  assert.deepEqual(s.calls.at(-1), { key: 'b', answer: null });
  await s.settle('ok');
  assert.equal(queue.pending, 0);
});

test('a newer answer replaces one still waiting, never the one being sent', async () => {
  const s = server();
  const queue = new SaveQueue(s.save, () => undefined, noWait);
  queue.push({ key: 'a', answer: 'cat' });
  queue.push({ key: 'b', answer: 'dgo' });
  queue.push({ key: 'b', answer: 'dog' });
  queue.push({ key: 'a', answer: 'cut' });
  await s.settle('ok');
  await s.settle('ok');
  await s.settle('ok');
  assert.deepEqual(
    s.calls.map((c) => `${c.key}:${c.answer}`),
    ['a:cat', 'b:dog', 'a:cut'],
  );
});

test('a failed save is retried until it lands, and trouble is reported and cleared', async () => {
  const s = server();
  const trouble: boolean[] = [];
  const queue = new SaveQueue(s.save, (t) => trouble.push(t), noWait);
  queue.push({ key: 'a', answer: 'cat' });
  const done = queue.idle();
  await s.settle('fail');
  await s.settle('fail');
  await s.settle('ok');
  await done;
  assert.equal(s.calls.length, 3);
  assert.deepEqual(trouble, [true, false]);
});

test('handing in waits until everything is saved', async () => {
  const s = server();
  const queue = new SaveQueue(s.save, () => undefined, noWait);
  let idle = false;
  queue.push({ key: 'a', answer: 'cat' });
  void queue.idle().then(() => (idle = true));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(idle, false);
  await s.settle('ok');
  assert.equal(idle, true);
  assert.equal(await queue.idle().then(() => 'at once'), 'at once');
});

test('a gone attempt stops the saving', async () => {
  const s = server();
  const queue = new SaveQueue(s.save, () => undefined, noWait);
  queue.push({ key: 'a', answer: 'cat' });
  queue.push({ key: 'b', answer: 'dog' });
  await s.settle('stop');
  await queue.idle();
  queue.push({ key: 'c', answer: 'cow' });
  assert.equal(s.calls.length, 1);
  assert.equal(queue.pending, 0);
});
