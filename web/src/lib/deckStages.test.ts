import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deckStages } from './deckStages.ts';

test('words in plain stages, the empty ones left out', () => {
  assert.equal(deckStages({ word_count: 100, met: 68, learned: 21 }), 'знаю 21 · учу 47 · впереди 32');
  assert.equal(deckStages({ word_count: 30, met: 11, learned: 0 }), 'учу 11 · впереди 19');
  assert.equal(deckStages({ word_count: 30, met: 30, learned: 30 }), 'знаю 30');
});
