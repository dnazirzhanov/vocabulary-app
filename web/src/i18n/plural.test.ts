import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plural } from './plural.ts';

test('Russian plural forms', () => {
  const forms = { one: 'слово', few: 'слова', many: 'слов' };
  assert.deepEqual(
    [1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, forms)),
    ['слово', 'слова', 'слов', 'слов', 'слово', 'слова', 'слов'],
  );
});
