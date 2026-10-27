import type { Page } from '@playwright/test';
import { button, expect, finishSession, test } from './learner.ts';

/** The big figure with its unit beside it, e.g. «1 из 6 дней на этой неделе». */
const figure = (page: Page, unit: string) => page.getByText(unit).locator('..');

test('progress answers two questions: how many words, and how steadily', async ({ page, learner }) => {
  // A Monday: the whole week is still ahead, so the weekly nudge has room to show.
  await learner.travelTo(new Date('2026-11-02T09:00:00Z'));
  await page.goto('/');
  await button(page, 'Прогресс').click();
  await expect(page.getByRole('heading', { name: 'Прогресс' })).toBeFocused();
  await expect(page.getByRole('meter', { name: 'Слов изучено' })).toHaveAttribute('aria-valuenow', '0');
  await expect(figure(page, 'из 6 дней на этой неделе')).toHaveText(/^0\s*из 6 дней/);
  await expect(page.getByRole('img', { name: /^0 дней с выполненным планом/ })).toBeVisible();
  await expect(page.getByText('День засчитывается, когда выполнен ваш план: 5 слов за день.')).toBeVisible();
  await expect(page.getByText('Ещё 6 дней до цели недели')).toBeVisible();
  await button(page, 'Сегодня').click();

  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
  await expect(page.getByText('План на сегодня выполнен')).toBeVisible();
  await button(page, 'На главную').click();
  // One day of six promised: no week kept yet, so no streak to show.
  await expect(page.getByText(/подряд/)).toHaveCount(0);

  await button(page, 'Прогресс').click();
  await expect(page.getByRole('meter', { name: 'Слов изучено' })).toHaveAttribute('aria-valuenow', '5');
  await expect(figure(page, 'из 1 300 слов')).toHaveText(/^5\s*из 1\s300\s*слов/);
  // Five new cards in memory, none well remembered yet.
  await expect(page.getByText('Ещё закрепляете').locator('..').locator('dd')).toHaveText('5');
  await expect(page.getByText('Помните хорошо').locator('..').locator('dd')).toHaveText('0');

  // Today counts toward the week and the calendar; the week is a commitment, not a streak.
  await expect(figure(page, 'из 6 дней на этой неделе')).toHaveText(/^1\s*из 6 дней/);
  await expect(page.getByRole('listitem', { name: /план выполнен/ })).toHaveAttribute('aria-current', 'date');
  await expect(page.getByRole('img', { name: /^1 день с выполненным планом/ })).toBeVisible();
  await expect(page.getByText('Ещё 5 дней до цели недели')).toBeVisible();
});
