import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deckTitleFor, isNewTopic, sameTopic } from './topics.ts';

test('a topic is the same however it is written, or when one contains the other', () => {
  assert.ok(sameTopic('Климат', '  климат '));
  assert.ok(sameTopic('изменение климата', 'климат')); // contains it
  assert.ok(sameTopic('Еда', 'ЕДА'));
  assert.ok(sameTopic('всё о еде', 'все о еде')); // ё is е
  assert.ok(!sameTopic('технологии', 'климат'));
});

test('only a deck that has topics, meeting a different one, offers a new deck', () => {
  assert.equal(isNewTopic('технологии', ['климат']), true);
  assert.equal(isNewTopic('климат', ['технологии', 'Климат']), false);
  assert.equal(isNewTopic('технологии', []), false); // a deck's first topic is just its topic
  assert.equal(isNewTopic('   ', ['климат']), false);
});

test('a new deck is named after its topic', () => {
  assert.equal(deckTitleFor('  технологии '), 'Технологии');
  assert.equal(deckTitleFor('в   аэропорту'), 'В аэропорту');
});
