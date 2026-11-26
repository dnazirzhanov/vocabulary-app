import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Serial } from './queue.ts';

test('work runs in the order asked, each after the one before, even after a failure', async () => {
  const serial = new Serial();
  const seen: string[] = [];
  const slow =
    (name: string, ms: number, fail = false) =>
    () =>
      new Promise<string>((resolve, reject) =>
        setTimeout(() => {
          seen.push(name);
          if (fail) reject(new Error(name));
          else resolve(name);
        }, ms),
      );
  const a = serial.run(slow('mark', 30));
  const b = serial.run(slow('unmark', 1, true));
  const c = serial.run(slow('mark again', 5));
  assert.equal(await a, 'mark');
  await assert.rejects(b);
  assert.equal(await c, 'mark again');
  assert.deepEqual(seen, ['mark', 'unmark', 'mark again']);
});
