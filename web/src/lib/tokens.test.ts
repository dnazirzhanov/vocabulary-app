import assert from 'node:assert/strict';
import { test } from 'node:test';
import { glossarySlug, tokenize } from './tokens.ts';

test('a sentence splits into tappable words and the text between them', () => {
  assert.deepEqual(tokenize("Don't forget the café!"), [
    { text: "Don't", key: "don't" },
    { text: ' ', key: null },
    { text: 'forget', key: 'forget' },
    { text: ' ', key: null },
    { text: 'the', key: 'the' },
    { text: ' ', key: null },
    { text: 'café', key: 'café' },
    { text: '!', key: null },
  ]);
});

test('glossary audio file names drop apostrophes', () => {
  assert.equal(glossarySlug("can't"), 'cant');
  assert.equal(glossarySlug('café'), 'café');
});
