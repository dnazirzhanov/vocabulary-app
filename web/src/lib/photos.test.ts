import assert from 'node:assert/strict';
import { test } from 'node:test';
import { takePhotos, tidyPhotoText } from './photos.ts';

test('up to four photos a draft, and no more than the deck has left', () => {
  assert.deepEqual(takePhotos(3, 0, 8), { take: 3, note: null });
  assert.deepEqual(takePhotos(5, 0, 8), {
    take: 4,
    note: 'Взяли первые 4\u00a0фото: за один раз — не больше 4\u00a0фото.',
  });
  assert.deepEqual(takePhotos(2, 3, 8).take, 1); // three already read into this draft
  assert.deepEqual(takePhotos(4, 0, 2), {
    take: 2,
    note: 'Взяли первые 2\u00a0фото: для этой колоды осталось 2\u00a0фото.',
  });
  assert.equal(takePhotos(1, 4, 8).note, 'За один раз — не больше 4\u00a0фото. Подберите слова, потом добавьте ещё.');
  assert.equal(takePhotos(1, 0, 0).note, 'В эту колоду больше нельзя добавить фото: их уже 8. Вставьте текст вручную.');
});

test('photo text is tidied: hyphenated line breaks joined, blank runs shortened', () => {
  assert.equal(tidyPhotoText('  The experi-\nment was\n\n\n\ncarried out.  \n'), 'The experiment was\n\ncarried out.');
});
