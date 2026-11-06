import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deadlineLeft, localToday, standingLabel } from './deadline.ts';

const THURSDAY = '2026-11-05';

test('today is the local calendar day', () => {
  assert.equal(localToday(new Date(2026, 10, 5, 23, 59)), '2026-11-05');
});

test('a standing in words, for a teacher and for the learner', () => {
  assert.equal(standingLabel({ status: 'on_track', behind: 0 }), 'успевает');
  assert.equal(standingLabel({ status: 'behind', behind: 4 }), 'отстаёт на 4\u00a0слова');
  assert.equal(standingLabel({ status: 'behind', behind: 4 }, true), 'отстаёте на 4\u00a0слова');
  assert.equal(standingLabel({ status: 'not_started', behind: 0 }), 'ещё не начато');
  assert.equal(standingLabel({ status: 'not_started', behind: 3 }), 'ещё не начато, отстаёт на 3\u00a0слова');
  assert.equal(standingLabel({ status: 'done', behind: 0 }, true), 'все слова встречены');
});

test('a deadline in «Мои колоды»: days to go and words left', () => {
  assert.equal(deadlineLeft('2026-11-07', THURSDAY, 6), 'до срока 2\u00a0дня, осталось 6\u00a0слов');
  assert.equal(deadlineLeft('2026-11-06', THURSDAY, 1), 'срок завтра, осталось 1\u00a0слово');
  assert.equal(deadlineLeft(THURSDAY, THURSDAY, 2), 'срок сегодня, осталось 2\u00a0слова');
  assert.equal(deadlineLeft('2026-11-01', THURSDAY, 3), 'срок прошёл, осталось 3\u00a0слова');
  assert.equal(deadlineLeft('2026-11-07', THURSDAY, 0), 'к 7 ноября: все слова встречены');
});
