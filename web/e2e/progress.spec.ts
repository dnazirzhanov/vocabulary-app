import { answer, button, expect, test } from './learner.ts';

test('progress shows the goal, the streak and the words met', async ({ page }) => {
  await page.goto('/');
  await button(page, 'Прогресс').click();
  await expect(page.getByText('До цели 30 очков')).toBeVisible();
  await expect(page.getByText('Появится после первого повторения')).toBeVisible();
  await button(page, 'На главную').click();

  await button(page, 'Начать урок').click();
  for (let step = 0; step < 15; step += 1) await answer(page);
  await expect(page.getByText('+50 очков')).toBeVisible();
  await expect(page.getByText('цель на сегодня выполнена')).toBeVisible();
  await button(page, 'На главную').click();
  await expect(page.getByText('1 день подряд')).toBeVisible();

  await button(page, 'Прогресс').click();
  await expect(page.getByRole('heading', { name: 'Прогресс' })).toBeVisible();
  await expect(page.getByText('Цель выполнена')).toBeVisible();
  await expect(page.getByRole('meter')).toHaveAttribute('aria-valuenow', '30');
  const introduced = page.getByText('Познакомились', { exact: true }).locator('..');
  await expect(introduced).toContainText('5');

  // The chart's values are reachable without hovering: focus and the table view.
  await page.getByRole('img', { name: /50 очков/ }).focus();
  await page.getByText('Показать таблицей').click();
  await expect(page.getByRole('row')).toHaveCount(8);
});
