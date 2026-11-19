import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  answerOf,
  backspace,
  differences,
  pick,
  picksOf,
  removeAt,
  slotWords,
  tileForKey,
  withSeparators,
} from './spelling.ts';

// "apple" from a bank with two separate p tiles.
const TILES = ['a', 'c', 'e', 'l', 'p', 'p', 'r', 't'];

test('apple is built from two separate p tiles', () => {
  let picked: number[] = [];
  for (const tile of [0, 4, 5, 3, 2]) picked = pick(picked, tile, 5);
  assert.equal(answerOf(TILES, picked), 'apple');
});

test('a tile is used once, and slots never overflow', () => {
  assert.deepEqual(pick([4], 4, 5), [4]);
  assert.deepEqual(pick([0, 1, 2, 3, 4], 5, 5), [0, 1, 2, 3, 4]);
});

test('removing a letter shifts the rest left and frees its tile', () => {
  const picked = removeAt([0, 4, 5, 3], 1);
  assert.deepEqual(picked, [0, 5, 3]);
  assert.equal(answerOf(TILES, picked), 'apl');
  assert.deepEqual(pick(picked, 4, 5), [0, 5, 3, 4]);
  assert.deepEqual(backspace(picked), [0, 5]);
});

test('typing a letter picks the next free tile with it, repeats included', () => {
  assert.equal(tileForKey(TILES, [], 'P'), 4);
  assert.equal(tileForKey(TILES, [4], 'p'), 5);
  assert.equal(tileForKey(TILES, [4, 5], 'p'), null);
  assert.equal(tileForKey(TILES, [], 'z'), null);
  assert.equal(tileForKey(TILES, [], 'Enter'), null);
});

test('the letters that differ are marked', () => {
  assert.deepEqual(
    differences('aplpe', 'apple').map((d) => d.differs),
    [false, false, true, true, false],
  );
});

test("a phrase's gaps are put back between its letters", () => {
  assert.equal(withSeparators('carryout', [{ after: 5, char: ' ' }]), 'carry out');
  assert.equal(withSeparators('wellknown', [{ after: 4, char: '-' }]), 'well-known');
  assert.equal(withSeparators('house', []), 'house');
  // Half-built: a gap appears once a letter follows it.
  assert.equal(withSeparators('carry', [{ after: 5, char: ' ' }]), 'carry');
});

test("a phrase's slots are grouped by word; hyphens stay inside a word", () => {
  assert.deepEqual(slotWords(8, [{ after: 5, char: ' ' }]), [
    [0, 1, 2, 3, 4],
    [5, 6, 7],
  ]);
  assert.deepEqual(slotWords(9, [{ after: 4, char: '-' }]), [[0, 1, 2, 3, 4, 5, 6, 7, 8]]);
  assert.deepEqual(slotWords(3, []), [[0, 1, 2]]);
});

test('a saved answer is rebuilt from the tiles, a repeated letter from its own tile', () => {
  // «well-known»: the hyphen is built in, never a tile.
  const tiles = ['n', 'l', 'w', 'o', 'k', 'e', 'l', 'n', 'w'];
  const picked = picksOf(tiles, 'well-known');
  assert.deepEqual(picked, [2, 5, 1, 6, 4, 0, 3, 8, 7]);
  assert.equal(answerOf(tiles, picked), 'wellknown');
  assert.deepEqual(picksOf(tiles, null), []);
  // A letter with no tile left is passed over rather than invented.
  assert.deepEqual(picksOf(['a', 'b'], 'abb'), [0, 1]);
});
