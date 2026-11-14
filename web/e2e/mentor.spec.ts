import { expect, test } from './learner.ts';

test.use({ mentor: true });

test("the Mentor tab shows a greeting, a tip, and today's plan", async ({ page }) => {
  await page.goto('/');
  // Home loads first — then click «Наставник» in the nav shell.
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();

  // The greeting is the <h1>; its wording depends on the time of day, so match any of the four.
  const greeting = page.getByRole('heading', { level: 1 });
  await expect(greeting).toBeVisible();
  await expect(greeting).toHaveText(/Доброе утро|Добрый день|Добрый вечер|Доброй ночи/);

  // The tip is always shown under its «Совет» heading; its wording depends on real state.
  await expect(page.getByText('Совет', { exact: true })).toBeVisible();

  // Plan section is always rendered with its heading — empty state or cards beneath it.
  await expect(page.getByRole('heading', { level: 2, name: 'План на сегодня' })).toBeVisible();
});
