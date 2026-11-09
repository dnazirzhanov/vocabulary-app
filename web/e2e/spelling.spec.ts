import type { Page } from '@playwright/test';
import { button, expect, finishSession, openDeck, test } from './learner.ts';

/** Today's lesson: five new cards, then its summary, where spelling is offered next. */
async function lesson(page: Page) {
  await page.goto('/');
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
}

const tile = (page: Page, letter: string) =>
  page.getByRole('group', { name: 'Буквы' }).getByRole('button', { name: letter, exact: true }).first();

test('spelling follows the lesson: a card per new word, built from its meaning', async ({ page }) => {
  await lesson(page);
  // Spelling is practice, offered after the lesson (ADR 0022).
  await button(page, 'Правописание · 5 слов').click();

  const card = page.locator('[data-spelling]');
  await expect(card.getByRole('heading', { level: 1 })).toHaveText('дом');
  await expect(page.locator('main')).not.toContainText('house'); // the word is never shown
  const check = button(page, 'Проверить');
  await expect(check).toBeDisabled();

  await tile(page, 'h').click();
  await tile(page, 'o').click();
  // A used tile leaves an empty, disabled place; removing the letter brings it back there.
  await expect(page.getByRole('button', { name: 'h, уже в ответе' })).toBeDisabled();
  await page.getByRole('button', { name: 'Буква 1: h, убрать' }).click();
  await expect(page.getByRole('button', { name: 'Буква 1: o, убрать' })).toBeVisible(); // shifted left
  await expect(tile(page, 'h')).toBeEnabled();
  await button(page, 'Очистить').click();
  await expect(page.getByRole('group', { name: 'Ответ: 0 из 5 букв' })).toBeVisible();

  for (const letter of 'house') await tile(page, letter).click();
  await check.click();
  await expect(page.getByRole('status')).toContainText('Верно');
  await button(page, 'Дальше').click();
  await expect(card.getByRole('heading', { level: 1 })).toHaveText('вода');
});

test('a mistake shows the word, and the card can be built again until right', async ({ page }) => {
  await lesson(page);
  await button(page, 'Правописание · 5 слов').click();
  await expect(page.locator('[data-spelling] h1')).toHaveText('дом'); // the card is there to type into
  await page.keyboard.type('huose');
  await button(page, 'Проверить').click();
  const feedback = page.getByRole('status');
  await expect(feedback).toContainText('Почти');
  await expect(feedback).toContainText('Ваш ответ');
  await expect(feedback).toContainText('Правильно');
  await expect(feedback.locator('mark')).toHaveCount(2); // the two letters out of place

  await button(page, 'Собрать ещё раз').click();
  await expect(page.locator('[data-spelling] [lang="en"]')).toHaveText('house'); // shown now
  await page.keyboard.type('house');
  await expect(page.getByRole('status')).toContainText('Верно');
  await button(page, 'Дальше').click();

  await finishSession(page);
  await expect(page.getByRole('heading', { name: 'Правописание готово' })).toBeVisible();
  await expect(
    page.getByText('5 слов · 4 верно с первого раза · 1 с ошибкой. Слова с ошибкой вернутся завтра.'),
  ).toBeVisible();
});

test('the deck page offers ten words at a time, and other modes; a half-built word survives a reload', async ({
  page,
}) => {
  await lesson(page);
  await button(page, 'На главную').click(); // back on the deck's page
  // The main button: today's words, never spelled (ADR 0026).
  await expect(button(page, 'Правописание · 5 слов')).toContainText(
    'Слова, которые вы ещё не писали — из любой колоды',
  );
  await expect(button(page, 'Правописание: другие режимы')).toBeVisible();
  await button(page, 'Правописание · 5 слов').click();
  await tile(page, 'h').click();
  await tile(page, 'o').click();
  await page.reload();
  await openDeck(page);
  await button(page, 'Продолжить правописание').click();
  await expect(page.getByRole('group', { name: 'Ответ: 2 из 5 букв' })).toBeVisible();
  await button(page, 'Очистить').click();
  await finishSession(page, {}, { water: 'wtaer' });
  // All spelled: nothing more for the main button now, so home is the only step.
  await expect(button(page, 'Ещё 5 слов')).toHaveCount(0);
  await button(page, 'На главную').click();
  await expect(page.getByRole('button', { name: /^Правописание · \d/ })).toHaveCount(0);

  // The other modes: today's words again, the hard one, or a random draw; 5 to 30 at a time.
  await expect(button(page, 'Правописание')).toHaveAccessibleDescription(/Трудных слов: 1/);
  await button(page, 'Правописание').click();
  const dialog = page.getByRole('dialog', { name: 'Правописание' });
  await expect(dialog.getByRole('radio', { name: /Сегодняшние/ })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /Трудные 1 слово с ошибкой/ })).toBeEnabled();
  await dialog.getByRole('radio', { name: /Трудные/ }).check();
  await expect(dialog.getByRole('button', { name: 'Начать · 1 слово' })).toBeVisible();
  await dialog.getByRole('radio', { name: /Сегодняшние/ }).check();
  await dialog.getByRole('button', { name: '20', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '20', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Начать · 5 слов' }).click();
  await finishSession(page);
  await expect(page.getByRole('heading', { name: 'Без единой ошибки!' })).toBeVisible();

  // The ladder shows where spelling is chosen: the misspelled word is hard (spelled right since,
  // but not yet due).
  await button(page, 'На главную').click();
  await button(page, 'Правописание').click();
  await expect(page.getByRole('dialog', { name: 'Правописание' })).toContainText(
    '1\u00a0слово с ошибкой в прошлый раз',
  );
});

test('one hint per card fills the next letter, and only that one', async ({ page }) => {
  await lesson(page);
  await button(page, 'Правописание · 5 слов').click();
  await expect(page.locator('[data-spelling] h1')).toHaveText('дом');
  await tile(page, 'h').click();
  await tile(page, 'o').click();
  const hint = page.getByRole('button', { name: 'Подсказка: буква' });
  await hint.click();
  // The third slot gets its letter; the word's other letters stay hidden.
  await expect(page.getByRole('button', { name: 'Буква 3: u (подсказка), убрать' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Ответ: 3 из 5 букв' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подсказка использована' })).toBeDisabled();
  await expect(page.locator('main')).not.toContainText('house');

  // Still one hint after a reload.
  await page.reload();
  await openDeck(page);
  await button(page, 'Продолжить правописание').click();
  await expect(page.getByRole('button', { name: 'Подсказка использована' })).toBeDisabled();
});

test('spelling left midway waits with its progress on the deck page, not home, and resumes there', async ({ page }) => {
  await lesson(page);
  await button(page, 'Правописание · 5 слов').click();
  await spellOne(page, 'house'); // right
  await spellOne(page, 'wtaer'); // a mistake
  await page.getByRole('button', { name: 'Выйти из урока' }).click();

  // Back on the deck's page: the spelling is there with how far it got, not gone.
  const card = button(page, 'Продолжить правописание');
  await expect(card).toHaveAccessibleDescription('Написано 2 из 5 (верно 1, с ошибкой 1) · осталось 3 слова');
  await expect(page.getByRole('progressbar', { name: 'Написано слов' })).toHaveAttribute('aria-valuenow', '2');
  // A lesson is not blocked by it: the deck's own button is still a lesson's.
  await expect(button(page, 'Ещё 5 слов')).toBeVisible();

  // Home stays about decks: the spelling waits on the deck's page, and resumes at the third word.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Мои колоды' })).toBeVisible();
  await expect(card).toHaveCount(0);
  await openDeck(page);
  await card.click();
  await expect(page.locator('[data-spelling] h1')).toHaveText('друг, подруга');
  await finishSession(page);
  await expect(page.getByText('5 слов · 4 верно с первого раза · 1 с ошибкой.', { exact: false })).toBeVisible();
  await button(page, 'На главную').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Основа' })).toBeVisible();
  await expect(button(page, 'Продолжить правописание')).toHaveCount(0);
});

test('another mode can be chosen while a spelling waits, and replaces it', async ({ page }) => {
  await lesson(page);
  await button(page, 'Правописание · 5 слов').click();
  await spellOne(page, 'house'); // right
  await spellOne(page, 'wtaer'); // a mistake, so one word is hard now
  await page.getByRole('button', { name: 'Выйти из урока' }).click();

  // Both ways on: carry on, or choose something else.
  await expect(button(page, 'Продолжить правописание')).toBeVisible();
  await button(page, 'Правописание: другие режимы').click();
  await expect(page.getByRole('dialog')).toContainText('Незаконченное правописание закроется');
  await page.getByRole('radio', { name: /Трудные/ }).check();
  await button(page, 'Начать · 1 слово').click();

  await expect(page.locator('[data-spelling] h1')).toHaveText('вода');
  await page.getByRole('button', { name: 'Выйти из урока' }).click();

  // The chosen set is what waits now; the one before is gone, and its mistake stayed hard.
  await expect(button(page, 'Продолжить правописание')).toHaveAccessibleDescription(
    'Написано 0 из 1 · осталось 1 слово',
  );
  await button(page, 'Продолжить правописание').click();
  await expect(page.locator('[data-spelling] h1')).toHaveText('вода');
});

/** Builds the current spelling card from a keyboard and moves on. */
async function spellOne(page: Page, built: string) {
  await expect(page.locator('[data-spelling] h1')).toBeVisible();
  await page.keyboard.type(built);
  await button(page, 'Проверить').click();
  await button(page, 'Дальше').click();
}

test('the sound is a hint: said on a tap, as often as asked, without showing the word or using the letter', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const played: string[] = [];
    (window as unknown as { played: string[] }).played = played;
    HTMLMediaElement.prototype.play = function () {
      played.push(decodeURIComponent(new URL(this.currentSrc || this.src).pathname));
      return Promise.resolve();
    };
  });
  const played = () => page.evaluate(() => (window as unknown as { played: string[] }).played);
  await lesson(page);
  await button(page, 'Правописание · 5 слов').click();
  const card = page.locator('[data-spelling]');
  await expect(card.getByRole('heading', { level: 1 })).toHaveText('дом');

  // Nothing plays until asked: not the lesson's last card's word, and not this one.
  const before = (await played()).length;
  await page.waitForTimeout(300);
  expect(await played()).toHaveLength(before);
  expect((await played()).slice(before)).not.toContain('/audio/words/house.mp3');

  // Only one speaker here: the auto-play switch belongs to flashcards.
  await expect(page.getByRole('button', { name: 'Произносить слово автоматически' })).toHaveCount(0);
  // Offered with the letter, below the tiles, not as part of the question.
  const hints = page.getByRole('group', { name: 'Подсказки' });
  await expect(hints).toContainText('Подсказки:');
  await expect(hints.getByRole('button')).toHaveCount(2);
  await expect(card.locator('[class*="prompt"]').getByRole('button')).toHaveCount(0);
  const listen = hints.getByRole('button', { name: 'Подсказка: звук' });
  await listen.click();
  await listen.click();
  await expect
    .poll(async () => (await played()).slice(before))
    .toEqual(['/audio/words/house.mp3', '/audio/words/house.mp3']);
  // Heard, never shown, and the letter hint is still there to use.
  await expect(page.locator('main')).not.toContainText('house');
  await expect(page.getByRole('button', { name: 'Подсказка: буква' })).toBeEnabled();

  // Listening is remembered across a reload, so the word can't pass as spelled from memory.
  await page.reload();
  await openDeck(page);
  await button(page, 'Продолжить правописание').click();
  await expect(card.getByRole('heading', { level: 1 })).toHaveText('дом');

  // The keyboard still works after a click: letters, then Enter checks rather than plays again.
  await listen.click();
  await page.keyboard.type('house');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Верно');
  // Sent with the next sync (ADR 0062): heard, so not spelled from memory.
  const sent = page.waitForRequest((request) => request.url().endsWith('/api/sync/push'));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const ops = (await sent).postDataJSON().ops as { kind: string; response: unknown }[];
  expect(ops.filter((op) => op.kind === 'study.answer').map((op) => op.response)).toContainEqual({
    kind: 'spelling',
    answer: 'house',
    heard: true,
  });
  await expect(hints).toHaveCount(0); // a hint is for before answering

  // The next card says its own word.
  await button(page, 'Дальше').click();
  await expect(card.getByRole('heading', { level: 1 })).toHaveText('вода');
  await listen.click();
  await expect.poll(async () => (await played()).at(-1)).toBe('/audio/words/water.mp3');
});

test('a word with no recording is said by the device', async ({ page, context }) => {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    (window as unknown as { spoken: string[] }).spoken = spoken;
    speechSynthesis.speak = (utterance) => void spoken.push(utterance.text);
  });
  const deck = await (await context.request.post('/api/decks', { data: { title: 'Свои слова' } })).json();
  await context.request.post(`/api/decks/${deck.id}/words`, {
    data: { headword: 'setback', pos: 'noun', translation: 'неудача', example: 'A setback.' },
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: /Свои слова/ })
    .first()
    .click();
  await button(page, 'Начать урок · 1 слово').click();
  await finishSession(page);
  await button(page, 'Правописание · 1 слово').click();
  await expect(page.locator('[data-spelling]').getByRole('heading', { level: 1 })).toHaveText('неудача');

  // The lesson's flashcard said it by itself; from here on, only when asked.
  const spoken = () => page.evaluate(() => (window as unknown as { spoken: string[] }).spoken);
  const before = (await spoken()).length;
  await page.waitForTimeout(300);
  expect(await spoken()).toHaveLength(before);
  await button(page, 'Подсказка: звук').click();
  await expect.poll(async () => (await spoken()).slice(before)).toEqual(['setback']);
  await expect(page.locator('main')).not.toContainText('setback');
});
