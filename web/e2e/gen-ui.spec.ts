import type { Page } from '@playwright/test';
import { expect, test } from './learner.ts';
import { openMentorChat, openMentorPlan } from './mentorNav.ts';

/**
 * The mentor composes the interface (ADR 0077): a component for today, the kind of day, a question
 * answered with a tap; and today's plan beside the chat on a wide screen.
 */
test.use({ mentor: true });

async function ask(page: Page, message: string) {
  await page.goto('/');
  await openMentorChat(page);
  const composer = page.getByRole('textbox', { name: 'Напишите вопрос…' });
  await composer.fill(message);
  await composer.press('Enter');
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('today on a line, with only today’s blocks', async ({ page }) => {
    await page.request.post('/api/mentor/schedule', {
      data: { title: 'Отдых', kind: 'rest', weekdays: 127, start_minute: 14 * 60, end_minute: 15 * 60 },
    });
    await ask(page, 'Как выглядит мой день?');
    await expect(page.getByText('Твой день')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: '14:00–15:00' }).last()).toContainText('Отдых');
  });

  test('the kind of day is answered in the chat, and the home follows', async ({ page }) => {
    await ask(page, 'Я устал сегодня');
    const card = page.getByRole('group', { name: 'Какой сегодня день?' });
    await card.getByRole('button', { name: 'Лёгкий день' }).click();
    await expect(card.getByRole('button', { name: 'Лёгкий день' })).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/');
    await openMentorPlan(page);
    await expect(page.getByText('Лёгкий день', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Какой сегодня день?' })).toHaveCount(0);
  });

  test('a question is answered with a tap, sent as the learner’s message', async ({ page }) => {
    await ask(page, 'Сколько минут в день мне заниматься?');
    await page.getByRole('button', { name: '20', exact: true }).click();
    await expect(
      page
        .locator('li')
        .filter({ has: page.getByText('20', { exact: true }) })
        .last(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '20', exact: true })).toBeDisabled();
  });
});

test('on a wide screen today’s plan stays beside the chat', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await ask(page, 'Привет');
  const panel = page.getByRole('complementary', { name: 'План на сегодня' });
  await expect(panel).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(panel).toBeHidden();
});
