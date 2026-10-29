import { type Page } from '@playwright/test';
import { button, expect, finishSession, test } from './learner.ts';

const DAY = 86_400_000;

/** One of today's three numbers on home, by its name. */
const today = (page: Page, name: 'Новые' | 'Изучаемые' | 'К повторению') =>
  page.getByRole('region', { name: /^(Сегодня|На сегодня всё)$/ }).locator(`dt:text-is("${name}") + dd`);
const deckRow = (page: Page, title: string) => page.getByRole('button', { name: new RegExp(`^${title}`) });

test('home counts today like Anki: new, learning and due, in all and per deck', async ({ page, learner }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeFocused();
  await expect(today(page, 'Новые')).toHaveText('5');
  await expect(today(page, 'К повторению')).toHaveText('0');
  await expect(deckRow(page, 'Основа')).toHaveAccessibleName(/A1–A2 · 0 из 100 5 новых 0 изучаемых 0 к повторению/);
  // Later levels wait for the one before.
  await expect(deckRow(page, 'Уверенный уровень')).toHaveAccessibleName(/после уровня «Основа» закрыта/);
  await expect(deckRow(page, 'Продвинутый уровень')).toHaveAccessibleName(/закрыта/);

  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
  await button(page, 'На главную').click();
  // Today's new words are done; what is left is a bonus.
  await expect(page.getByRole('heading', { name: 'На сегодня всё', exact: true })).toBeFocused();
  await expect(today(page, 'Новые')).toHaveText('0');
  await expect(button(page, 'Ещё 5 слов')).toBeVisible();

  await learner.travelTo(new Date(Date.now() + 10 * DAY));
  await page.reload();
  await expect(today(page, 'К повторению')).toHaveText('5');
  await expect(deckRow(page, 'Основа')).toHaveAccessibleName(/5 новых 0 изучаемых 5 к повторению/);

  // Tapping a deck studies that deck, and leaving the lesson comes back home.
  await deckRow(page, 'Основа').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('house');
  await page.getByRole('button', { name: 'Выйти из урока' }).click();
  await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeFocused();
  await expect(button(page, 'Продолжить урок')).toBeVisible();
});

test('a locked level is not pressable and says what opens it', async ({ page }) => {
  await page.goto('/');
  await expect(deckRow(page, 'Уверенный уровень')).toBeDisabled();
  await expect(deckRow(page, 'Продвинутый уровень')).toBeDisabled();
  await expect(deckRow(page, 'Уверенный уровень')).toContainText('после уровня «Основа»');
});

test("tapping a deck after today's target gives a bonus lesson", async ({ page }) => {
  await page.goto('/');
  await deckRow(page, 'Основа').click();
  await finishSession(page);
  await button(page, 'На главную').click();
  await expect(today(page, 'Новые')).toHaveText('0');
  await deckRow(page, 'Основа').click();
  await expect(page.getByRole('button', { name: 'Показать ответ' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('house'); // the next words
});
