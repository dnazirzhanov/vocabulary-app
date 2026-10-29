import type { Page } from '@playwright/test';
import { button, expect, finishSession, test } from './learner.ts';

/** The big figure with its unit beside it, e.g. «1 из 6 дней на этой неделе». */
const figure = (page: Page, unit: string) => page.getByText(unit).locator('..');

test('progress answers two questions: how many words, and how steadily', async ({ page }) => {
  await page.goto('/');
  await button(page, 'Прогресс').click();
  await expect(page.getByRole('heading', { name: 'Прогресс' })).toBeFocused();
  await expect(page.getByRole('meter', { name: 'Слов изучено' })).toHaveAttribute('aria-valuenow', '0');
  await expect(figure(page, 'из 6 дней на этой неделе')).toHaveText(/^0\s*из 6 дней/);
  await expect(page.getByRole('img', { name: /^0 дней с выполненной целью/ })).toBeVisible();
  await expect(page.getByText('Ещё 6 дней до цели недели')).toBeVisible();
  await button(page, 'Сегодня').click();

  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
  await expect(page.getByText('+50 очков')).toBeVisible();
  await button(page, 'На главную').click();
  await expect(page.getByText('1 день подряд')).toBeVisible();

  await button(page, 'Прогресс').click();
  await expect(page.getByRole('meter', { name: 'Слов изучено' })).toHaveAttribute('aria-valuenow', '5');
  await expect(figure(page, 'из 1 300 слов')).toHaveText(/^5\s*из 1\s300\s*слов/);
  // Five new cards in memory, none well remembered yet.
  await expect(page.getByText('Ещё закрепляете').locator('..').locator('dd')).toHaveText('5');
  await expect(page.getByText('Помните хорошо').locator('..').locator('dd')).toHaveText('0');

  // Today counts toward the week and the calendar; the week is a commitment, not a streak.
  await expect(figure(page, 'из 6 дней на этой неделе')).toHaveText(/^1\s*из 6 дней/);
  await expect(page.getByRole('listitem', { name: /цель выполнена/ })).toHaveAttribute('aria-current', 'date');
  await expect(page.getByRole('img', { name: /^1 день с выполненной целью/ })).toBeVisible();
  await expect(page.getByText('Ещё 5 дней до цели недели')).toBeVisible();
});
