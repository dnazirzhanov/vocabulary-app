import { button, expect, finishSession, openDeck, test } from './learner.ts';

const DAY = 86_400_000;

test('cards come back when they are due and are studied first', async ({ page, learner }) => {
  await page.goto('/');
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
  await button(page, 'На главную').click();

  await learner.travelTo(new Date(Date.now() + 10 * DAY));
  await page.reload();
  await openDeck(page);
  await expect(page.getByRole('region', { name: 'Сегодня в колоде' })).toContainText(/К повторению\s*5/);
  await page.getByRole('button', { name: /^Учить · 5 повт\. \+ 5 нов\./ }).click();

  // Reviews first: the first card is one of the five words met ten days ago.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('house');
  await finishSession(page, { house: 'Снова' });
  await expect(page.getByText(/повторили — 5\sслов/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Трудные сейчас/ })).toBeVisible();
});
