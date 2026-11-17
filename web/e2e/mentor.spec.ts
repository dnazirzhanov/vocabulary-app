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

  // The dashboard shows; click the «Написать наставнику» button to open the chat view.
  await page.getByRole('button', { name: 'Написать наставнику' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Спросить наставника' })).toBeVisible();

  // Suggestion chips appear once the chat history finishes loading; click the first one.
  const firstChip = page.locator('[data-testid="mentor-suggestion"]').first();
  await expect(firstChip).toBeVisible({ timeout: 10_000 });
  const chipText = (await firstChip.textContent()) ?? '';
  await firstChip.click();

  // After the reply, the log region is visible with the sent message.
  const log = page.getByRole('log');
  await expect(log).toBeVisible();
  await expect(log).toContainText(chipText);
  // The demo reply contains text from locale.py mentor_demo_reply (ru default).
  // The Playwright server forces demo mode (DEEPSEEK_API_KEY='') for deterministic tests.
  await expect(log).toContainText('Загляни в «Сегодня»', { timeout: 10_000 });
});

test('the goal chip shows the current goal and «Изменить цель» opens goal setup', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();

  // The fixture set goal='general' so the chip shows the goal label for «Общий».
  await expect(page.getByText('Общий', { exact: false })).toBeVisible();

  // «Изменить цель» opens the GoalSetup screen.
  await page.getByRole('button', { name: 'Изменить цель' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Какова ваша цель в английском?' })).toBeVisible();

  // Select a different goal type and save.
  await page
    .getByRole('button', { name: /IELTS|Путешествия|Бизнес|Общение|Академический|Общий/ })
    .first()
    .click();
  await page.getByRole('button', { name: /мин/ }).first().click();
  await page.getByRole('button', { name: 'Начать учёбу' }).click();

  // After saving, the dashboard returns.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Доброе утро|Добрый день|Добрый вечер|Доброй ночи/);
});

test('follow-up chips appear after the assistant replies', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();

  // Open chat view.
  await page.getByRole('button', { name: 'Написать наставнику' }).click();

  // Send a message so the assistant replies.
  const firstChip = page.locator('[data-testid="mentor-suggestion"]').first();
  await expect(firstChip).toBeVisible({ timeout: 10_000 });
  await firstChip.click();
  await expect(page.getByRole('log')).toContainText('Загляни в «Сегодня»', { timeout: 10_000 });

  // After the reply, follow-up chips should appear.
  await expect(page.locator('[data-testid="mentor-followup"]').first()).toBeVisible({ timeout: 5_000 });
});

test('clearing the chat removes all messages', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();

  // Open chat view.
  await page.getByRole('button', { name: 'Написать наставнику' }).click();

  // Send a message so the log appears.
  const firstChip = page.locator('[data-testid="mentor-suggestion"]').first();
  await expect(firstChip).toBeVisible({ timeout: 10_000 });
  await firstChip.click();
  await expect(page.getByRole('log')).toContainText('Загляни в «Сегодня»', { timeout: 10_000 });

  // Clear the chat.
  await page.getByRole('button', { name: 'Очистить чат' }).click();

  // The log disappears and suggestion chips are back.
  await expect(page.getByRole('log')).toHaveCount(0);
  await expect(page.locator('[data-testid="mentor-suggestion"]').first()).toBeVisible();
});
