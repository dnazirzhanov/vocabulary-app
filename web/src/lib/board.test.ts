import assert from 'node:assert/strict';
import { test } from 'node:test';
import { visibleLines } from './board.ts';
import { nicknameProblem, suggestNicknames } from './nickname.ts';
import type { BoardRow } from './types.ts';

const rows = (count: number, me: number): BoardRow[] =>
  Array.from({ length: count }, (_, index) => ({
    member_id: `m${index}`,
    nickname: `n${index}`,
    role: 'member',
    is_me: index === me,
    rank: index + 1,
    plan_days: 7 - Math.min(6, index),
    promised_days: 7,
    week: Array(7).fill(false),
    streak_weeks: 0,
  }));
const shape = (lines: ReturnType<typeof visibleLines>) =>
  lines.map((line) => (line.kind === 'gap' ? `…${line.hidden}` : line.row.nickname));

test('small boards show everyone', () => {
  assert.equal(visibleLines(rows(10, 9)).length, 10);
});

test('big boards show the top 3 and the learner with two neighbours each side', () => {
  assert.deepEqual(shape(visibleLines(rows(20, 10))), ['n0', 'n1', 'n2', '…5', 'n8', 'n9', 'n10', 'n11', 'n12', '…7']);
  assert.deepEqual(shape(visibleLines(rows(20, 3))), ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', '…14']);
  assert.deepEqual(shape(visibleLines(rows(20, 19))), ['n0', 'n1', 'n2', '…14', 'n17', 'n18', 'n19']);
});

test('generated nicknames agree and pass the rules', () => {
  let seed = 0;
  const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const names = suggestNicknames(5, random);
  assert.equal(new Set(names).size, 5);
  for (const name of names) assert.equal(nicknameProblem(name), null, name);
});

test('typed nicknames follow the server rules', () => {
  assert.equal(nicknameProblem('  Ёжик   7 '), null);
  assert.equal(nicknameProblem('ivan@mail.ru'), 'Только буквы, цифры, пробел и дефис.');
  assert.equal(nicknameProblem('0555123456'), 'Имя не может быть номером.');
  assert.equal(nicknameProblem('wwwfun'), 'Без ссылок.');
  assert.equal(nicknameProblem('a'), 'Не короче 2 символов.');
});
