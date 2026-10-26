import assert from 'node:assert/strict';
import { test } from 'node:test';
import { relativeDay } from './relativeDay.ts';

test('days are counted by local calendar date', () => {
  const evening = new Date(2026, 10, 2, 23, 30);
  assert.equal(relativeDay(new Date(2026, 10, 3, 0, 15), evening), 'завтра');
  assert.equal(relativeDay(new Date(2026, 10, 2, 23, 59), evening), 'сегодня');
  assert.equal(relativeDay(new Date(2026, 10, 5, 9, 0), evening), 'через 3 дня');
  assert.equal(relativeDay(new Date(2026, 10, 18, 9, 0), evening), 'через 16 дней');
});

test('an overdue review reads as today', () => {
  assert.equal(relativeDay(new Date(2026, 10, 1), new Date(2026, 10, 2)), 'сегодня');
});
