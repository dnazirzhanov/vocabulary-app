import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentDeck, deckToday, studyLabel } from './today.ts';
import type { Deck } from './types.ts';

const deck = (id: string, fields: Partial<Deck> = {}): Deck => ({
  id,
  title: id,
  description: '',
  level: null,
  level_order: 0,
  locked: false,
  course_goal: null,
  word_count: 100,
  introduced_count: 0,
  due_count: 0,
  learning_count: 0,
  review_count: 0,
  new_today: 0,
  next_due_at: null,
  ...fields,
});
test('the current level is the last one open', () => {
  assert.equal(currentDeck([deck('a'), deck('b', { locked: true })])?.id, 'a');
  assert.equal(currentDeck([deck('a'), deck('b'), deck('c', { locked: true })])?.id, 'b');
  assert.equal(currentDeck([]), undefined);
});

test('the study button says what the session holds', () => {
  assert.equal(studyLabel({ due: 0, fresh: 5, started: false, bonus: false }), 'Начать урок · 5\u00a0слов');
  assert.equal(studyLabel({ due: 4, fresh: 5, started: true, bonus: false }), 'Учить · 4 повт. + 5 нов.');
  assert.equal(studyLabel({ due: 3, fresh: 0, started: true, bonus: false }), 'Повторить · 3\u00a0слова');
  assert.equal(studyLabel({ due: 0, fresh: 5, started: true, bonus: true }), 'Ещё 5\u00a0слов');
  assert.equal(studyLabel({ due: 0, fresh: 0, started: true, bonus: false }), null);
});

test("a deck's day in one sentence, never a table of counts", () => {
  const day = { locked: false, blocked: false, fresh: 0, due: 0, bonus: false, left: 10, nextReview: null };
  assert.equal(deckToday({ ...day, fresh: 5, due: 1 }), 'Сегодня 5\u00a0новых слов и 1 на повторение.');
  assert.equal(deckToday({ ...day, fresh: 1 }), 'Сегодня 1\u00a0новое слово.');
  assert.equal(deckToday({ ...day, fresh: 3 }), 'Сегодня 3\u00a0новых слова.');
  assert.equal(deckToday({ ...day, due: 1 }), 'Сегодня 1\u00a0слово на повторение.');
  assert.equal(deckToday({ ...day, bonus: true }), 'На сегодня всё. Можно взять ещё слов.');
  assert.equal(deckToday({ ...day, nextReview: 'завтра' }), 'На сегодня всё. Следующее повторение — завтра.');
  assert.equal(deckToday({ ...day, left: 0 }), 'Все слова колоды встречены.');
  assert.equal(
    deckToday({ ...day, blocked: true, due: 40 }),
    'Сначала повторение: 40\u00a0слов. Новые слова — сразу после него.',
  );
});
