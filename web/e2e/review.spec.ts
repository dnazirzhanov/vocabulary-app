import { button, expect, finishSession, test } from './learner.ts';

const DAY = 86_400_000;

test('cards come back when they are due and are studied first', async ({ page, learner }) => {
  await page.goto('/');
  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
  await button(page, 'На главную').click();

  await learner.travelTo(new Date(Date.now() + 10 * DAY));
  await page.reload();
  await expect(page.getByText('Пора повторить 5 слов')).toBeVisible();
  await page.getByRole('button', { name: /^Учить · 5 повт\. \+ 5 нов\./ }).click();

  // Reviews first: the front asks to recall, there is no "new word" label.
  await expect(page.getByText('Вспомните перевод')).toBeVisible();
  await finishSession(page, { house: 'Снова' });
  await expect(page.getByText(/повторили — 5\sслов/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Трудные сейчас/ })).toBeVisible();
});
