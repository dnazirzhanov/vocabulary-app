import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daysToMask, maskToDays } from './types.ts';

test('Monday only → bit 1', () => {
  assert.equal(daysToMask([0]), 1);
});

test('Mon–Fri → 31 (1|2|4|8|16)', () => {
  assert.equal(daysToMask([0, 1, 2, 3, 4]), 31);
});

test('every day → 127', () => {
  assert.equal(daysToMask([0, 1, 2, 3, 4, 5, 6]), 127);
});

test('mask round-trips through daysToMask ∘ maskToDays', () => {
  for (const mask of [1, 31, 85, 127, 42, 64]) {
    assert.equal(daysToMask(maskToDays(mask)), mask);
  }
});

test('maskToDays returns a sorted list', () => {
  assert.deepEqual(maskToDays(31), [0, 1, 2, 3, 4]);
  assert.deepEqual(maskToDays(64), [6]);
  assert.deepEqual(maskToDays(65), [0, 6]);
});
