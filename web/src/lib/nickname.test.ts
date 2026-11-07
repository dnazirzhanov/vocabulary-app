import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nicknameProblem, suggestNicknames } from './nickname.ts';
import { en } from '../i18n/en.ts';
import { kk } from '../i18n/kk.ts';
import { ky } from '../i18n/ky.ts';
import { tg } from '../i18n/tg.ts';
import { uz } from '../i18n/uz.ts';

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

test("a nickname may be in any of the app's languages", () => {
  for (const name of ['Айгүл', 'Қанат', 'Ҷамшед', 'G‘ayrat', 'Gʻayrat', "O'g'il", 'Анна-Мария']) {
    assert.equal(nicknameProblem(name), null, name);
  }
  assert.notEqual(nicknameProblem('a@b.c'), null);
});

test('every generated nickname, in every language, passes the rules', () => {
  for (const messages of [en, uz, kk, ky, tg]) {
    for (const adjective of messages.nicknameAdjectives) {
      for (const animal of messages.nicknameAnimals) {
        const name = `${adjective} ${animal}`;
        if (name.length <= 20) assert.equal(nicknameProblem(name), null, name);
      }
    }
  }
});
