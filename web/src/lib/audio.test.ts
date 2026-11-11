import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampRate } from './audio.ts';

test('the example speed stays within 0.5×–2×, on a 0.25× step', () => {
  assert.equal(clampRate(1), 1);
  assert.equal(clampRate(1.3), 1.25);
  assert.equal(clampRate(1.4), 1.5);
  assert.equal(clampRate(0.1), 0.5);
  assert.equal(clampRate(3), 2);
  assert.equal(clampRate(Number.NaN), 1);
});
