import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggestEmail } from './emailTypo.ts';

test('a slip in a common mail domain is offered its fix', () => {
  // The pilot student's address: the code went nowhere.
  assert.equal(suggestEmail('kitkatbro886@gamil.com'), 'kitkatbro886@gmail.com');
  assert.equal(suggestEmail('anna@gmial.com'), 'anna@gmail.com');
  assert.equal(suggestEmail('anna@gmail.co'), 'anna@gmail.com');
  assert.equal(suggestEmail('anna@gmail.con'), 'anna@gmail.com');
  assert.equal(suggestEmail(' Anna@Gmal.com '), 'anna@gmail.com');
  assert.equal(suggestEmail('ivan@mail.ri'), 'ivan@mail.ru');
  assert.equal(suggestEmail('ivan@yandex.r'), 'ivan@yandex.ru');
  assert.equal(suggestEmail('ivan@yandx.ru'), 'ivan@yandex.ru');
});

test('a right address, or one far from any common domain, is left alone', () => {
  assert.equal(suggestEmail('anna@gmail.com'), null);
  assert.equal(suggestEmail('teacher@school.kg'), null);
  assert.equal(suggestEmail('anna@university.edu'), null);
  assert.equal(suggestEmail('anna@'), null);
  assert.equal(suggestEmail('not an email'), null);
  // Short domains: one slip at most.
  assert.equal(suggestEmail('ivan@bk.ru'), null);
  assert.equal(suggestEmail('ivan@ab.kg'), null);
});
