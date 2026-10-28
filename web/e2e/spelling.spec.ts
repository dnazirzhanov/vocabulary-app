import type { Page } from '@playwright/test';
import { button, expect, finishSession, spellToday, test } from './learner.ts';

/** Today's lesson: five new cards, then its summary, where spelling is offered next. */
async function lesson(page: Page) {
  await page.goto('/');
  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
}

const tile = (page: Page, letter: string) =>
  page.getByRole('group', { name: 'Буквы' }).getByRole('button', { name: letter, exact: true }).first();

test('spelling follows the lesson: a card per new word, built from its meaning', async ({ page }) => {
  await lesson(page);
  await expect(page.getByText('Осталось правописание')).toBeVisible();
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
  await expect(page.getByRole('list', { name: 'Ответ: 0 из 5 букв' })).toBeVisible();

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
  await expect(page.getByText('5 слов · 4 верно с первого раза · 1 с ошибкой.')).toBeVisible();
  await expect(page.getByText('План на сегодня выполнен')).toBeVisible(); // a mistake never blocks it
});

test('the day waits for spelling; it can be repeated and a half-built word survives a reload', async ({ page }) => {
  await lesson(page);
  await button(page, 'На главную').click();
  const plan = page.getByRole('region', { name: 'План на сегодня' });
  await expect(plan).toContainText(/Правописание\s*0\s*из 5\sслов/);

  await button(page, 'Правописание · 5 слов').click(); // the main button once the cards are done
  await tile(page, 'h').click();
  await tile(page, 'o').click();
  await page.reload();
  await button(page, 'Продолжить урок').click();
  await expect(page.getByRole('list', { name: 'Ответ: 2 из 5 букв' })).toBeVisible();
  await button(page, 'Очистить').click();
  await finishSession(page);
  await button(page, 'На главную').click();
  await expect(plan).toContainText(/Правописание\s*5\s*из 5\sслов/);

  // Practice again, as often as wanted: the day is already done, nothing changes.
  await spellToday(page);
  await expect(page.getByRole('heading', { name: 'Без единой ошибки!' })).toBeVisible();
  await expect(button(page, 'Ещё раз')).toBeVisible();
});
