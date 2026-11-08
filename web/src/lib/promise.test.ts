import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dotsLabel, knownLine, promiseText, todayLists, weekdaysOf, wordsCaption, wordsProgress } from './promise.ts';
import type { BoardRow, MemberDeck } from './types.ts';

test('the promise in words: runs of three days collapse, others are listed', () => {
  assert.equal(promiseText([0, 1, 2, 3, 4]), 'Пн–Пт');
  assert.equal(promiseText([0, 2, 4]), 'Пн Ср Пт');
  assert.equal(promiseText([0, 1, 3, 4]), 'Пн Вт Чт Пт');
  assert.equal(promiseText([0, 1, 2, 4]), 'Пн–Ср Пт');
  assert.equal(promiseText([4, 0, 2]), 'Пн Ср Пт'); // order doesn't matter
  assert.equal(promiseText([5, 6]), 'Сб Вс');
  assert.equal(promiseText([0, 1, 2, 3, 4, 5, 6]), 'каждый день');
});

test("a week's yes/no flags become weekdays", () => {
  assert.deepEqual(weekdaysOf([true, false, true, false, true, false, false]), [0, 2, 4]);
});

test('a week of dots is also said in words', () => {
  assert.equal(
    dotsLabel(['done', 'missed', 'today', 'later', 'later', 'off', 'off']),
    'Неделя: Пн — сделано, Вт — пропущено, Ср — сегодня, ещё нет, Чт — впереди, Пт — впереди, Сб — не по обещанию, Вс — не по обещанию',
  );
});

const deck = (title: string, learned: number, word_count: number): MemberDeck => ({
  deck_id: title,
  title,
  word_count,
  met: learned,
  learned,
});
const friend = (name: string, values: Partial<BoardRow> = {}): BoardRow =>
  ({ name, member_id: name, promise_today: 'pending', known: 0, decks: [], ...values }) as BoardRow;

test("today's names are listed by who did it, who has not yet, and who has the day off", () => {
  const rows = [
    friend('Я', { promise_today: 'pending' }),
    friend('Али', { promise_today: 'done' }),
    friend('Бек', { promise_today: 'off' }),
    friend('Вика', { promise_today: 'done' }),
  ];
  assert.deepEqual(
    todayLists(rows).map((list) => [list.title, list.rows.map((row) => row.name)]),
    [
      ['Сделали сегодня', ['Али', 'Вика']],
      ['Не сделали', ['Я']],
      ['Сегодня выходной', ['Бек']],
    ],
  );
  // A list nobody is in is not shown.
  assert.deepEqual(
    todayLists([friend('Я', { promise_today: 'done' })]).map((list) => list.state),
    ['done'],
  );
});

test("a friend's words are measured against the deck given to the group", () => {
  const one = friend('А', { decks: [{ ...deck('Unit 4', 12, 30), met: 17 }] });
  assert.deepEqual(wordsProgress(one), { met: 17, learned: 12, total: 30 });
  // With several decks the bar is the total.
  const two = friend('А', { decks: [deck('Unit 4', 12, 30), deck('Unit 5', 3, 20)] });
  assert.deepEqual(wordsProgress(two), { met: 15, learned: 15, total: 50 });
  // No deck, or a deck with no words: nothing to measure against.
  assert.equal(wordsProgress(friend('А')), null);
  assert.equal(wordsProgress(friend('А', { decks: [deck('Пустая', 0, 0)] })), null);
});

test('the deck is named once, above the lists', () => {
  assert.equal(wordsCaption([friend('А', { decks: [deck('Unit 4', 1, 30)] })]), 'Слова из «Unit 4»');
  assert.equal(
    wordsCaption([friend('А', { decks: [deck('Unit 4', 1, 30), deck('Unit 5', 0, 20)] })]),
    'Слова из колод группы',
  );
  assert.equal(wordsCaption([friend('А')]), null);
});

test('without a deck the row says only how many words the friend knows', () => {
  assert.equal(knownLine(friend('А', { known: 25 })), 'выучено слов: 25');
  assert.equal(knownLine(friend('А')), '');
});
