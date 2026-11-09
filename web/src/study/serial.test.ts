import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serializer } from './serial.ts';

test('calls run one at a time, in order, and a failure does not stop the next', async () => {
  const serial = serializer('test', undefined);
  const events: string[] = [];
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const run = (name: string, ms: number, fail = false) =>
    serial(async () => {
      events.push(`start ${name}`);
      await pause(ms);
      events.push(`end ${name}`);
      if (fail) throw new Error(name);
      return name;
    });
  const results = await Promise.allSettled([run('a', 20), run('b', 1, true), run('c', 1)]);
  assert.deepEqual(events, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled', 'rejected', 'fulfilled'],
  );
});
