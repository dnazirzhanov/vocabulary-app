import { button, expect, finishSession, spell, study, test } from './learner.ts';
import type { Page } from '@playwright/test';

/** Rates today's five new cards «Легко», so the lesson moves straight on to spelling. */
async function cardsDone(page: Page) {
  await page.goto('/');
  await button(page, 'Начать урок · 5 слов').click();
  for (let n = 0; n < 5; n += 1) await study(page, 'Легко');
}

const tile = (page: Page, letter: string) =>
  page.getByRole('group', { name: 'Буквы' }).getByRole('button', { name: letter, exact: true }).first();

test('guided spelling: tiles fill the slots, come back to their place, and check when full', async ({ page }) => {
  await cardsDone(page);
  const exercise = page.locator('[data-spelling]');
  await expect(exercise.getByRole('heading', { level: 1 })).toHaveText('house'); // the word is shown
  await expect(exercise).toContainText('дом');
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
  await expect(check).toBeEnabled();
  await check.click();
  await expect(page.getByRole('status')).toContainText('Верно');
  await button(page, 'Дальше').click();
  await expect(exercise.getByRole('heading', { level: 1 })).toHaveText('water');
});

test('recall hides the word; a miss is corrected, practised and retried once', async ({ page }) => {
  await cardsDone(page);
  for (let n = 0; n < 5; n += 1) await spell(page); // guided: house, water, friend, buy, cheap

  const exercise = page.locator('[data-spelling]');
  await expect(exercise.getByRole('heading', { level: 1 })).toHaveText('дом');
  await expect(exercise.locator('[lang="en"]')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('house');
  await expect(page.getByRole('list', { name: 'Ответ: 0 из 5 букв' })).toBeVisible();

  await page.keyboard.type('huose');
  await button(page, 'Проверить').click();
  const feedback = page.getByRole('status');
  await expect(feedback).toContainText('Почти');
  await expect(feedback).toContainText('Ваш ответ');
  await expect(feedback).toContainText('Правильно');
  await expect(feedback.locator('mark')).toHaveCount(2); // the two letters out of place
  await button(page, 'Потренировать написание').click();
  // Guided practice of the word comes straight away; the retry comes later in the lesson.
  await expect(exercise.getByRole('heading', { level: 1 })).toHaveText('house');

  await finishSession(page);
  await expect(page.getByText('Правописание: 5 слов · 4 верно с первого раза · 1 повторим ещё')).toBeVisible();
});

test('a half-built word survives a reload, and the day waits for the spelling', async ({ page }) => {
  await cardsDone(page);
  await tile(page, 'h').click();
  await tile(page, 'o').click();
  await page.getByRole('button', { name: 'Выйти из урока' }).click();

  // Home: the cards are done, the spelling is the rest of today's plan.
  const plan = page.getByRole('region', { name: 'План на сегодня' });
  await expect(plan).toContainText('Правописание');
  await expect(plan).toContainText(/0\s*из 5\sслов/);

  await page.reload();
  await button(page, 'Продолжить урок').click();
  await expect(page.getByRole('list', { name: 'Ответ: 2 из 5 букв' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Буква 2: o, убрать' })).toBeVisible();
  await button(page, 'Очистить').click();
  await finishSession(page);
  await expect(page.getByText('План на сегодня выполнен')).toBeVisible();
});
