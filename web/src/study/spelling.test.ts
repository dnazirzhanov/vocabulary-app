import assert from 'node:assert/strict';
import { test } from 'node:test';
import { roundHalfEven } from './fsrs.ts';
import { isCorrect, letters, tiles } from './spelling.ts';

// Tile banks are random (seeded only on the server), so they are checked by what they must be.
test('a tile bank holds every letter of the word and a few more, and never spells it out', () => {
  let seed = 7;
  const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (const word of ['house', 'carry out', 'mother-in-law', 'a', 'abcdefghijklmnop', 'well-known']) {
    for (let n = 0; n < 50; n += 1) {
      const bank = tiles(word, random);
      const bare = letters(word);
      assert.equal(bank.length, Math.max(15, bare.length + 4), word);
      const left = [...bank];
      for (const letter of bare) left.splice(left.indexOf(letter), 1);
      assert.equal(left.length, bank.length - bare.length, `${word}: every letter has its tile`);
      assert.ok(
        left.every((letter) => !bare.includes(letter)),
        `${word}: extra tiles are other letters`,
      );
      if (bare.length > 1) assert.ok(!bank.join('').includes(bare), `${word}: the bank doesn't spell the word`);
    }
  }
});

test('an answer is checked as the server checks it', () => {
  assert.ok(isCorrect('  House ', 'house'));
  assert.ok(isCorrect('carry out', 'Carry out'));
  assert.ok(!isCorrect('', ''));
  assert.ok(!isCorrect('huose', 'house'));
});

test("Python's rounding: halves go to the even number", () => {
  assert.deepEqual([0.5, 1.5, 2.5, 3.5, 2.4999, 2.5001].map(roundHalfEven), [0, 2, 2, 4, 2, 3]);
});
