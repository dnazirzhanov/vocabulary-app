import { button, expect, finishSession, test } from './learner.ts';

test('the path shows the level and stone, and the frog moves on after a finished stone', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Уровень 1 из 3' })).toBeVisible();
  await expect(page.getByText('Камень 1 из 6 · 0 из 30 слов')).toBeVisible();
  const stones = page.getByRole('button', { name: /^Камень \d из 6/ });
  await expect(stones).toHaveCount(6);
  await expect(stones.first()).toHaveAccessibleName(/вы здесь/);

  // A stone lists its words on request.
  await stones.nth(1).click();
  await expect(page.getByText('Камень 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: /^morning/ })).toBeVisible();

  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
  await button(page, 'На главную').click();

  await expect(page.getByText('Камень 2 из 6 · 5 из 30 слов')).toBeVisible();
  await expect(stones.nth(0)).toHaveAccessibleName(/пройден/);
  await expect(stones.nth(1)).toHaveAccessibleName(/вы здесь/);
  await expect(page.getByText('Вы перешли на камень 2.')).toBeAttached();
});
