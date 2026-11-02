import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deckGoal, deckStages } from './deckGoal.ts';

const deck = { word_count: 30, met: 11, learned: 0, new_today: 2, goal_today: 5, pace: 5, deadline: null };

test('words in plain stages, the empty ones left out', () => {
  assert.equal(deckStages({ ...deck, word_count: 100, met: 68, learned: 21 }), 'знаю 21 · учу 47 · впереди 32');
  assert.equal(deckStages(deck), 'учу 11 · впереди 19');
  assert.equal(deckStages({ ...deck, met: 30, learned: 30 }), 'знаю 30');
});

test("today's words still to do, then the finish at the deck's pace", () => {
  assert.deepEqual(deckGoal(deck), { text: 'Сегодня: 3 новых · ≈ 4\u00a0дня до конца', pending: true });
});

test('done for today, more than planned included, says so once', () => {
  assert.deepEqual(deckGoal({ ...deck, new_today: 8 }), {
    text: '✓ на сегодня · ≈ 4\u00a0дня до конца',
    pending: false,
  });
});

test("a teacher's deadline replaces the estimate; a finished deck says what comes next", () => {
  assert.equal(deckGoal({ ...deck, deadline: 'к 2 ноября' }).text, 'Сегодня: 3 новых · к 2 ноября');
  assert.equal(deckGoal({ ...deck, met: 30 }).text, 'Все слова пройдены — дальше повторения');
  assert.equal(deckGoal({ ...deck, goal_today: 0 }).text, '≈ 4\u00a0дня до конца');
});
