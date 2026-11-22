import type { Page } from '@playwright/test';
import { expect, test } from './learner.ts';
import { openMentorChat } from './mentorNav.ts';

/**
 * The app as tools (ADR 0079): the mentor looks things up (a step, no card) and proposes changes
 * such as reminders, which apply only on a tap.
 */
test.use({ mentor: true, viewport: { width: 390, height: 844 } });

async function ask(page: Page, message: string) {
  await page.goto('/');
  await openMentorChat(page);
  const composer = page.getByRole('textbox', { name: 'Напишите вопрос…' });
  await composer.fill(message);
  await composer.press('Enter');
}

test('a lookup shows as a step the mentor took', async ({ page }) => {
  await ask(page, 'Что я делал вчера?');
  await expect(page.getByRole('status').filter({ hasText: 'Смотрю, что ты делал' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Копировать' })).toBeVisible();
});

test('reminders are changed only on the tap', async ({ page }) => {
  await ask(page, 'Выключи напоминания');
  await expect(page.getByText('Напоминания', { exact: true })).toBeVisible();
  await expect(page.getByText('В 17:00: если сегодня ещё не занимались')).toBeVisible();
  const before = await (await page.request.get('/api/me')).json();
  expect(before.notify_afternoon).toBe(true);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Сохранено')).toBeVisible();
  const after = await (await page.request.get('/api/me')).json();
  expect([after.notify_afternoon, after.notify_morning]).toEqual([false, false]);
});
