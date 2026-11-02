import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentDeck, studyLabel } from './today.ts';
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
