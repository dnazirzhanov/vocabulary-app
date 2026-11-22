import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clockText, percentOf, scoreText, secondsLeft, verdictText } from './groupTests.ts';

const deadline = '2026-11-05T09:10:00.000Z';

test('the clock counts whole seconds up, so it never reads 0:00 with time left', () => {
  assert.equal(secondsLeft(deadline, new Date('2026-11-05T09:00:00.000Z')), 600);
  assert.equal(secondsLeft(deadline, new Date('2026-11-05T09:09:59.500Z')), 1);
});

test('the clock stops at zero', () => {
  assert.equal(secondsLeft(deadline, new Date('2026-11-05T09:10:00.000Z')), 0);
  assert.equal(secondsLeft(deadline, new Date('2026-11-05T10:00:00.000Z')), 0);
});

test('the clock reads as minutes and seconds', () => {
  assert.equal(clockText(600), '10:00');
  assert.equal(clockText(65), '1:05');
  assert.equal(clockText(0), '0:00');
});

test('a result says how many of how many, and whether it passed', () => {
  assert.equal(scoreText({ correct: 8, total: 10 }), '8 из 10 · 80%');
  assert.equal(scoreText({ correct: 5, total: 30 }), '5 из 30 · 16%');
  assert.equal(verdictText(true), 'Сдано');
  assert.equal(verdictText(false), 'Не сдано');
});

test('the percent is rounded down, so a score short of the pass mark never shows it', () => {
  assert.equal(percentOf(39, 49), 79); // 79.6 %: still short of 80 %
  assert.equal(percentOf(40, 50), 80);
  assert.equal(percentOf(1, 3), 33);
  assert.equal(percentOf(3, 3), 100);
  assert.equal(percentOf(0, 0), 0);
});
