import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deadlineLeft, deadlineNote, localToday, standingLabel } from './deadline.ts';

const THURSDAY = '2026-11-05';

test("a deadline days ahead names today's share and keeps the last day for review", () => {
  assert.equal(
    deadlineNote('2026-11-07', THURSDAY, 6, 12, 1),
    'Выучить к 7 ноября. Сегодня 6\u00a0слов, чтобы успеть, — последний день останется для повторения.',
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
    'Выучить к 6 ноября — это завтра: сегодня все 12\u00a0слов, завтра повторение.',
  );
  assert.equal(deadlineNote(THURSDAY, THURSDAY, 3, 3, 1), 'Срок — сегодня: осталось 3\u00a0слова.');
  assert.equal(deadlineNote(THURSDAY, THURSDAY, 0, 0, 1), 'Срок — сегодня. Все слова встречены: повторите их.');
  assert.equal(
    deadlineNote('2026-11-01', THURSDAY, 2, 2, 1),
    'Срок был 1 ноября: осталось 2\u00a0слова — сегодня все.',
  );
  assert.equal(deadlineNote('2026-11-01', THURSDAY, 0, 0, 1), null);
  assert.equal(deadlineNote(null, THURSDAY, 0, 5, 1), null);
});

test('today is the local calendar day', () => {
  assert.equal(localToday(new Date(2026, 10, 5, 23, 59)), '2026-11-05');
});

test('a standing in words, for a teacher and for the learner', () => {
  assert.equal(standingLabel({ status: 'on_track', behind: 0 }), 'успевает');
  assert.equal(standingLabel({ status: 'behind', behind: 4 }), 'отстаёт на 4\u00a0слова');
  assert.equal(standingLabel({ status: 'behind', behind: 4 }, true), 'отстаёте на 4\u00a0слова');
  assert.equal(standingLabel({ status: 'not_started', behind: 0 }), 'ещё не начинал');
  assert.equal(standingLabel({ status: 'not_started', behind: 3 }), 'ещё не начинал, отстаёт на 3\u00a0слова');
  assert.equal(standingLabel({ status: 'done', behind: 0 }, true), 'все слова встречены');
});

test('a deadline in «Мои колоды»: days to go and words left', () => {
  assert.equal(deadlineLeft('2026-11-07', THURSDAY, 6), 'до срока 2\u00a0дня, осталось 6\u00a0слов');
  assert.equal(deadlineLeft('2026-11-06', THURSDAY, 1), 'срок завтра, осталось 1\u00a0слово');
  assert.equal(deadlineLeft(THURSDAY, THURSDAY, 2), 'срок сегодня, осталось 2\u00a0слова');
  assert.equal(deadlineLeft('2026-11-01', THURSDAY, 3), 'срок прошёл, осталось 3\u00a0слова');
  assert.equal(deadlineLeft('2026-11-07', THURSDAY, 0), 'к 7 ноября: все слова встречены');
});
