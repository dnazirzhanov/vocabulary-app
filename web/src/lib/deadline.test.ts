import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deadlineNote, localToday } from './deadline.ts';

const THURSDAY = '2026-11-05';

test("a deadline days ahead names today's share and keeps the last day for review", () => {
  assert.equal(
    deadlineNote('2026-11-07', THURSDAY, 6, 12, 1),
    'Выучить к 7 ноября. Сегодня 6 слов, чтобы успеть, — последний день останется для повторения.',
  );
});

test('a pace that already covers the share just says so', () => {
  assert.equal(
    deadlineNote('2026-11-07', THURSDAY, 6, 12, 10),
    'Выучить к 7 ноября. Вашего темпа хватает, чтобы успеть с запасом на повторение.',
  );
});

test('a deadline tomorrow asks for every word today; today or past says what is left', () => {
  assert.equal(
    deadlineNote('2026-11-06', THURSDAY, 12, 12, 1),
    'Выучить к 6 ноября — это завтра: сегодня все 12 слов, завтра повторение.',
  );
  assert.equal(deadlineNote(THURSDAY, THURSDAY, 3, 3, 1), 'Срок — сегодня: осталось 3 слова.');
  assert.equal(deadlineNote(THURSDAY, THURSDAY, 0, 0, 1), 'Срок — сегодня. Все слова встречены: повторите их.');
  assert.equal(deadlineNote('2026-11-01', THURSDAY, 2, 2, 1), 'Срок был 1 ноября: осталось 2 слова — сегодня все.');
  assert.equal(deadlineNote('2026-11-01', THURSDAY, 0, 0, 1), null);
  assert.equal(deadlineNote(null, THURSDAY, 0, 5, 1), null);
});

test('today is the local calendar day', () => {
  assert.equal(localToday(new Date(2026, 10, 5, 23, 59)), '2026-11-05');
});
