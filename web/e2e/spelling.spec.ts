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
  await expect(button(page, 'Правописание')).toHaveAccessibleDescription(/На сегодня всё написано/);
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
  const hint = page.getByRole('button', { name: 'Подсказка' });
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

/** Builds the current spelling card from a keyboard and moves on. */
async function spellOne(page: Page, built: string) {
  await expect(page.locator('[data-spelling] h1')).toBeVisible();
  await page.keyboard.type(built);
  await button(page, 'Проверить').click();
  await button(page, 'Дальше').click();
}
