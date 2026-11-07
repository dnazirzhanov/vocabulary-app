import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startingLanguage } from './languages.ts';

test('a saved choice wins, then the device, then Russian', () => {
  assert.equal(startingLanguage('ky', ['en-US']), 'ky');
  assert.equal(startingLanguage(null, ['kk-KZ', 'ru']), 'kk');
  assert.equal(startingLanguage(null, ['uz-Cyrl-UZ']), 'uz');
  assert.equal(startingLanguage(null, ['fr-FR', 'tg']), 'tg');
  assert.equal(startingLanguage(null, ['fr-FR']), 'ru');
  assert.equal(startingLanguage('xx', []), 'ru');
  assert.equal(startingLanguage('constructor', []), 'ru');
});
