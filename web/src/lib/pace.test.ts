import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wordsLabel } from './pace.ts';

test('word counts agree in Russian', () => {
  assert.equal(wordsLabel(1), '1\u00a0слово');
  assert.equal(wordsLabel(3), '3\u00a0слова');
  assert.equal(wordsLabel(25), '25\u00a0слов');
});
