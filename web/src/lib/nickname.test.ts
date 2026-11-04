import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nicknameProblem, suggestNicknames } from './nickname.ts';

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
