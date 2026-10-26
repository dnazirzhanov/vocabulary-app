import { answer, button, expect, test } from './learner.ts';

test('every deck word can be browsed, filtered and searched', async ({ page }) => {
  await page.goto('/');
  await button(page, 'Начать урок · 5 слов').click();
  for (let step = 0; step < 15; step += 1) await answer(page);
  await button(page, 'На главную').click();

  await button(page, 'Все слова колоды · 30').click();
  await expect(page.getByRole('heading', { name: 'Слова колоды' })).toBeFocused();
  await expect(page.getByRole('listitem')).toHaveCount(30);
  // Nothing is hidden: an upcoming word shows its translation too.
  const city = page.getByRole('listitem').filter({ hasText: 'city' });
  await expect(city).toContainText('город');
  await expect(city).toContainText('Впереди');
  await expect(page.getByRole('listitem').filter({ hasText: 'house' })).toContainText('повтор завтра');

  await page.getByRole('button', { name: /^Новое/ }).click();
  await expect(page.getByRole('listitem')).toHaveCount(5);
  await page.getByRole('button', { name: /^Все/ }).click();

  await page.getByRole('searchbox').fill('вод');
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('listitem')).toContainText('water');
  await page.getByRole('searchbox').fill('zzz');
  await expect(page.getByText('Ничего не нашлось.')).toBeVisible();

  await button(page, 'На главную').click();
  await expect(page.getByRole('heading', { name: 'Первые слова' })).toBeVisible();
});
