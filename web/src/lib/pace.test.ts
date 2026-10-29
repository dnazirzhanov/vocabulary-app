import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dailyMinutes, formatMinutes, presetFor, wordsLabel } from './pace.ts';

test('daily time counts each word and its later reviews', () => {
  // 13 exercises per word at 10 s: the cost of the reviews dominates.
  assert.equal(dailyMinutes(3), 7);
  assert.equal(dailyMinutes(5), 11);
  assert.equal(dailyMinutes(20), 43);
  assert.equal(dailyMinutes(100), 217);
  assert.equal(dailyMinutes(5, 6), 7, "a quick learner's own answering time is used");
  assert.equal(dailyMinutes(1, 1), 1, 'never shows zero minutes');
});

test('minutes read naturally', () => {
  assert.equal(formatMinutes(11), '≈\u00a011\u00a0мин');
  assert.equal(formatMinutes(60), '≈\u00a01\u00a0ч');
  assert.equal(formatMinutes(217), '≈\u00a03\u00a0ч 37\u00a0мин');
  assert.equal(formatMinutes(65), '≈\u00a01\u00a0ч 05\u00a0мин');
});

test('word counts agree in Russian', () => {
  assert.equal(wordsLabel(1), '1\u00a0слово');
  assert.equal(wordsLabel(3), '3\u00a0слова');
  assert.equal(wordsLabel(25), '25\u00a0слов');
});

test('a custom number that matches a preset selects it', () => {
  assert.equal(presetFor(10)?.id, 'fast');
  assert.equal(presetFor(7), undefined);
});
