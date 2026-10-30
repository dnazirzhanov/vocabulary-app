import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deckGoal } from './deckGoal.ts';

const deck = { word_count: 30, met: 11, new_today: 2, goal_today: 5, pace: 5, deadline: null };

test("today's words still to do, then the finish at the deck's pace", () => {
  assert.deepEqual(deckGoal(deck), {
    text: 'сегодня 2 из 5 новых · осталось 19\u00a0слов ≈ 4\u00a0дня',
    pending: true,
  });
});

test('done for today, more than planned included, says so once', () => {
  assert.deepEqual(deckGoal({ ...deck, new_today: 8 }), {
    text: 'на сегодня ✓ · осталось 19\u00a0слов ≈ 4\u00a0дня',
    pending: false,
  });
});

test("a teacher's deadline replaces the estimate; a finished deck says what comes next", () => {
  assert.equal(deckGoal({ ...deck, deadline: 'к 2 ноября' }).text, 'сегодня 2 из 5 новых · к 2 ноября');
  assert.equal(deckGoal({ ...deck, met: 30 }).text, 'Все слова встречены — дальше повторения');
  assert.equal(deckGoal({ ...deck, goal_today: 0, pace: 5 }).text, 'осталось 19\u00a0слов ≈ 4\u00a0дня');
});
