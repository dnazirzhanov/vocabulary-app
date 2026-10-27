import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerOf, backspace, differences, pick, removeAt, tileForKey } from './spelling.ts';

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
