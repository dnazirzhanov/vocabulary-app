import { button, expect, finishSession, spellToday, test } from './learner.ts';

test('the profile shows the week against the promise, and extra learning apart', async ({ page }) => {
  // The learner promised 6 days a week, 5 words a day (e2e/learner.ts).
  await page.goto('/');
  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
  await spellToday(page); // the day's plan: the cards, then their spelling
  await button(page, 'На главную').click();
  await button(page, 'Ещё 5 слов').click(); // a bonus lesson: beyond the plan
  await finishSession(page);
  await expect(page.getByText('+5 слов сверх плана')).toBeVisible();
  await button(page, 'На главную').click();
  // Home has loaded (it moves focus to its heading then), so the window opens over a settled page.
  await expect(page.getByRole('heading', { name: 'На сегодня всё', exact: true })).toBeFocused();

  const opener = button(page, 'Профиль');
  await opener.click();
  const profile = page.getByRole('dialog', { name: 'Мой профиль' });
  await expect(profile).toContainText('Обещание: 6 дней в неделю по 5 слов');
  await expect(profile.getByText('из 6 дней на этой неделе').locator('..')).toHaveText(/^1\s*из 6/);
  await expect(profile.getByText('Слов по плану за неделю').locator('..').locator('dd')).toHaveText('5');
  await expect(profile.getByText('Всего слов').locator('..').locator('dd')).toHaveText('10');
  await expect(profile.getByRole('region', { name: 'Сверх плана на этой неделе' })).toContainText('+5 слов');

  await page.keyboard.press('Escape');
  await expect(profile).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('a new learner sees an empty week and nothing extra', async ({ page }) => {
  await page.goto('/');
  await button(page, 'Профиль').click();
  const profile = page.getByRole('dialog', { name: 'Мой профиль' });
  await expect(profile.getByText('из 6 дней на этой неделе').locator('..')).toHaveText(/^0\s*из 6/);
  await expect(profile.getByRole('region', { name: /Сверх плана/ })).toHaveCount(0);
});
