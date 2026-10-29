import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wordsIn } from './quickAdd.ts';

test('quick add takes words separated by commas, semicolons or lines; phrases stay whole', () => {
  assert.deepEqual(wordsIn('apple, carry out;reluctant\n  well-known  \n\n'), [
    'apple',
    'carry out',
    'reluctant',
    'well-known',
  ]);
  assert.deepEqual(wordsIn(' , ;\n'), []);
});
