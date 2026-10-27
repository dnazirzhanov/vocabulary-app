import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daysAfterOf, plural, weeksWord } from './plural.ts';

test('Russian plural forms', () => {
  const forms = { one: 'слово', few: 'слова', many: 'слов' };
  assert.deepEqual(
    [1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, forms)),
    ['слово', 'слова', 'слов', 'слов', 'слово', 'слова', 'слов'],
  );
});

test('days after «из N» take the genitive: из 1 дня, из 4 дней, из 21 дня', () => {
  assert.deepEqual([1, 2, 4, 5, 11, 21].map(daysAfterOf), ['дня', 'дней', 'дней', 'дней', 'дней', 'дня']);
});

test('weeks: 1 неделя, 3 недели, 5 недель', () => {
  assert.deepEqual([1, 3, 5, 22].map(weeksWord), ['неделя', 'недели', 'недель', 'недели']);
});
