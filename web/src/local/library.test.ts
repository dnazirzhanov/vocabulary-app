import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LibraryDeck } from '../lib/types.ts';
import { mergeMine } from './library.ts';

const server = (id: string, title: string, words = 3): LibraryDeck => ({
  id,
  title,
  word_count: words,
  introduced_count: 2,
  learning_count: 1,
  review_count: 0,
  new_today: 1,
  next_due_at: null,
  groups: [],
  group_name: null,
  author: null,
});
const kept = (id: string, title: string, cards: number, createdAt = '2026-11-08T09:00:00Z') => ({
  deck: { id, title, language: 'ru', status: 'draft', version: 1, createdAt },
  cards,
});

test('decks made, renamed or deleted on this device show as they are here', () => {
  const merged = mergeMine(
    [server('g-a', 'Старое имя'), server('g-b', 'Удалена здесь')],
    [kept('g-a', 'Новое имя', 5), kept('g-new', 'Сделана офлайн', 2)],
    true,
  );
  assert.deepEqual(
    merged.map((deck) => [deck.id, deck.title, deck.word_count, deck.introduced_count]),
    [
      ['g-new', 'Сделана офлайн', 2, 0],
      ['g-a', 'Новое имя', 5, 2],
    ],
  );
});

test('before this device has my decks, the server list is shown whole', () => {
  const merged = mergeMine([server('g-a', 'A'), server('g-b', 'B')], [kept('g-new', 'Новая', 0)], false);
  assert.deepEqual(
    merged.map((deck) => deck.id),
    ['g-new', 'g-a', 'g-b'],
  );
  assert.deepEqual(mergeMine([server('g-a', 'A')], null, true), [server('g-a', 'A')]);
});
