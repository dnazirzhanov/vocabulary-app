import type { Page } from '@playwright/test';
import { button, expect, finishSession, openDeck, test } from './learner.ts';

/** The big figure with its unit beside it, e.g. «1 из 6 дней на этой неделе». */
const figure = (page: Page, unit: string) => page.getByText(unit).locator('..');

test('progress answers two questions: what I remember, deck by deck, and how steadily', async ({ page, learner }) => {
  // A Monday: the whole week is still ahead, so the weekly nudge has room to show.
  await learner.travelTo(new Date('2026-11-02T09:00:00Z'));
  await page.goto('/');
  await button(page, 'Прогресс').click();
  await expect(page.getByRole('heading', { name: 'Прогресс' })).toBeFocused();
  // Nothing studied yet: no decks, and what «learned» means.
  await expect(page.getByText('Пока ничего не выучено')).toBeVisible();
  await expect(figure(page, 'из 6 дней на этой неделе')).toHaveText(/^0\s*из 6 дней/);
  await expect(page.getByText('День засчитывается, когда сделаны все повторения и 5\u00a0слов за день.')).toBeVisible();
  await expect(page.getByText('Ещё 6 дней до цели недели')).toBeVisible();
  await button(page, 'Сегодня').click();

  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
  // No reviews were due and the five new words are met: the day is kept, spelling or not.
  await expect(page.getByText('План на сегодня выполнен')).toBeVisible();
  await button(page, 'На главную').click();
  await expect(page.getByText(/подряд/)).toHaveCount(0);

  await button(page, 'Прогресс').click();
  // Met, not learned: a word counts as learned once recalled in a later review.
  await expect(figure(page, 'слов выучено')).toHaveText(/^0\s*слов выучено/);
  await expect(page.getByText('Надёжно — 0 · встречено — 5')).toBeVisible();
  const level = page.getByRole('button', { name: /^Основа/ });
  await expect(level).toContainText('0 %');
  await expect(level).toContainText('выучено 0 из 100\u00a0слов');

  // Today counts toward the week and the calendar; the week is a commitment, not a streak.
  await expect(figure(page, 'из 6 дней на этой неделе')).toHaveText(/^1\s*из 6 дней/);
  await expect(page.getByRole('listitem', { name: /план выполнен/ })).toHaveAttribute('aria-current', 'date');
  await expect(
    page.getByRole('img', { name: /^2026: 1 день с занятиями, из них 1 с выполненным планом$/ }),
  ).toBeVisible();
  // The year's heatmap (January to December) names a day on hover or tap.
  await expect(page.getByText('январь', { exact: true })).toBeVisible();
  await expect(page.getByText('декабрь', { exact: true })).toBeVisible();
  await expect(page.getByText(/^2026: 1 день с занятиями · \d+ карточ/)).toBeVisible();
  await page.locator('[data-today]').last().click();
  await expect(page.getByText(/: \d+ карточ\S* · план выполнен$/)).toBeVisible();
  await expect(page.getByText('Ещё 5 дней до цели недели')).toBeVisible();

  // A row opens the deck's page, which goes back to «Прогресс».
  await level.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Основа' })).toBeVisible();
  await button(page, 'Прогресс').first().click();
});
