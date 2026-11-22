import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clock, elapsed, idle, start, stop, timeToSubmit } from './stopwatch.ts';

test('a timer that was never started submits no time', () => {
  assert.equal(timeToSubmit(idle, 1_000_000), null);
  assert.equal(elapsed(idle, 1_000_000), 0);
});

test('it counts while running and keeps the time when stopped', () => {
  let w = start(idle, 0);
  assert.equal(elapsed(w, 65_900), 65); // whole seconds
  w = stop(w, 90_000);
  assert.equal(elapsed(w, 500_000), 90); // stopped: later time does not count
  assert.equal(timeToSubmit(w, 500_000), 90);
});

test('stopping and starting again adds the runs up', () => {
  let w = stop(start(idle, 0), 10_000);
  w = start(w, 100_000);
  assert.equal(elapsed(w, 105_000), 15);
});

test('a timer started and stopped at once still counts as used', () => {
  const w = stop(start(idle, 5_000), 5_000);
  assert.equal(timeToSubmit(w, 9_000), 0);
});

test('starting twice or stopping twice changes nothing', () => {
  const running = start(idle, 0);
  assert.equal(start(running, 50_000), running);
  const stopped = stop(running, 3_000);
  assert.equal(stop(stopped, 9_000), stopped);
});

test('a clock that moves backwards never shows negative time', () => {
  assert.equal(elapsed(start(idle, 10_000), 4_000), 0);
});

test('the clock reads m:ss', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(65), '1:05');
  assert.equal(clock(3725), '62:05');
});
