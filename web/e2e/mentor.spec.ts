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

test('the Mentor chat sends a message and shows a reply', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Спросить наставника' })).toBeVisible();

  // Suggested prompts appear before the first message.
  await expect(page.getByRole('button', { name: 'С чего начать сегодня?' })).toBeVisible();

  // Click a suggested prompt; the chip sends the message and a reply appears.
  await page.getByRole('button', { name: 'С чего начать сегодня?' }).click();
  // After the reply, the log region is visible with both messages.
  const log = page.getByRole('log');
  await expect(log).toBeVisible();
  await expect(log).toContainText('С чего начать сегодня?');
  // The demo reply contains text from locale.py mentor_demo_reply (ru default).
  // The Playwright server forces demo mode (DEEPSEEK_API_KEY='') for deterministic tests.
  await expect(log).toContainText('Загляни в «Сегодня»', { timeout: 10_000 });
});

test('the goal widget lets the learner set and clear a learning goal', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();

  // The goal widget always renders for mentor testers.
  await expect(page.getByText('Моя цель')).toBeVisible();

  // Click edit, type a goal, and save it.
  await page.getByRole('button', { name: 'Изменить цель' }).click();
  await page.getByPlaceholder('Например: хочу дойти до B2 к лету').fill('Дойти до B2');
  await page.getByRole('button', { name: 'Сохранить' }).click();

  // After saving, the goal text appears and "Сохранено" flash is shown briefly.
  await expect(page.getByText('Дойти до B2')).toBeVisible();

  // Edit again and clear the goal.
  await page.getByRole('button', { name: 'Изменить цель' }).click();
  await page.getByPlaceholder('Например: хочу дойти до B2 к лету').fill('');
  await page.getByRole('button', { name: 'Сохранить' }).click();

  // After clearing, the placeholder text reappears.
  await expect(page.getByText('Например: хочу дойти до B2 к лету')).toBeVisible();
});

test('clearing the chat removes all messages', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();

  // Send a message so the log appears.
  await page.getByRole('button', { name: 'С чего начать сегодня?' }).click();
  await expect(page.getByRole('log')).toContainText('Загляни в «Сегодня»', { timeout: 10_000 });

  // Clear the chat.
  await page.getByRole('button', { name: 'Очистить чат' }).click();

  // The log disappears and suggestion chips are back.
  await expect(page.getByRole('log')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'С чего начать сегодня?' })).toBeVisible();
});
