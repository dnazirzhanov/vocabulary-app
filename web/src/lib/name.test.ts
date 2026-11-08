import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nameProblem } from './name.ts';

test('a typed name follows the server rules', () => {
  assert.equal(nameProblem('  Ёжик   7 '), null);
  assert.equal(nameProblem('Анна К.'), null);
  assert.equal(nameProblem('ivan@mail.ru'), 'Только буквы, цифры, пробел и дефис.');
  assert.equal(nameProblem('ivan.ru'), 'Только буквы, цифры, пробел и дефис.');
  assert.equal(nameProblem('0555123456'), 'Имя не может быть номером.');
  assert.equal(nameProblem('1.2'), 'Только буквы, цифры, пробел и дефис.');
  assert.equal(nameProblem('wwwfun'), 'Без ссылок.');
  assert.equal(nameProblem('a'), 'Не короче 2 символов.');
});

test("a name may be in any of the app's languages", () => {
  for (const name of ['Айгүл', 'Қанат', 'Ҷамшед', 'G‘ayrat', 'Gʻayrat', "O'g'il", 'Анна-Мария']) {
    assert.equal(nameProblem(name), null, name);
  }
  assert.notEqual(nameProblem('a@b.c'), null);
});
