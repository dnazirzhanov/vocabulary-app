import { button, expect, finishSession, openDeck, test } from './learner.ts';

test('progress answers two questions: what I remember, deck by deck, and how steadily', async ({ page, learner }) => {
  // A Monday: the whole week is still ahead, so the weekly nudge has room to show.
  await learner.travelTo(new Date('2026-11-02T09:00:00Z'));
  await page.goto('/');
  await button(page, 'Прогресс').click();
  await expect(page.getByRole('heading', { name: 'Прогресс' })).toBeFocused();
  // Nothing studied yet: an invitation, no decks, and the week ahead.
  await expect(page.getByText('Начните первую колоду')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Колоды' })).toHaveCount(0);
  await expect(page.getByText('0 из 6 дней на этой неделе · ещё 6 дней до цели')).toBeVisible();
  await button(page, 'Сегодня').click();

  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
  // The summary keeps to the words: no plan line, no count of ratings.
  await expect(page.getByText('План на сегодня')).toHaveCount(0);
  await expect(page.getByText(/^Хорошо \d+$/)).toHaveCount(0);
  await button(page, 'На главную').click();
  await expect(page.getByText(/подряд/)).toHaveCount(0);

  await button(page, 'Прогресс').click();
  // Met, not known yet: a word is known once recalled in a later review (ADR 0034).
  await expect(page.getByText('Вы учите слов: 5')).toBeVisible();
  // Each deck as a card, in plain words: «учу · впереди», then its goal.
  const level = page.getByRole('button', { name: /^Основа/ });
  await expect(level).toContainText('5 / 100');
  await expect(level).toContainText('учу 5 · впереди 95');
  await expect(level).not.toContainText(/сегодня|до конца/);
  await expect(level).not.toContainText(/%|встречено|выучено/);

  // Today counts toward the week and the calendar; the week is a commitment, not a streak.
  await expect(page.getByText('1 из 6 дней на этой неделе · ещё 5 дней до цели')).toBeVisible();
  await expect(page.getByRole('listitem', { name: /день засчитан/ })).toHaveAttribute('aria-current', 'date');
  await expect(page.getByRole('img', { name: /^2026: 1 день с занятиями, из них засчитано 1$/ })).toBeVisible();
  // The year's heatmap (January to December) names a day on hover or tap.
  await expect(page.getByText('январь', { exact: true })).toBeVisible();
  await expect(page.getByText('декабрь', { exact: true })).toBeVisible();
  await expect(page.getByText(/^2026: 1 день с занятиями · \d+ карточ/)).toBeVisible();
  await page.locator('[data-today]').last().click();
  await expect(page.getByText(/: \d+ карточ\S* · день засчитан$/)).toBeVisible();

  // A row opens the deck's page, which goes back to «Прогресс».
  await level.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Основа' })).toBeVisible();
  await button(page, 'Прогресс').first().click();
});
