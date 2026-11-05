import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clockText, scoreText, secondsLeft, verdictText } from './groupTests.ts';

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
  assert.equal(scoreText({ correct: 8, total: 10 }), '8 из 10');
  assert.equal(verdictText(true), 'Сдано');
  assert.equal(verdictText(false), 'Не сдано');
});
