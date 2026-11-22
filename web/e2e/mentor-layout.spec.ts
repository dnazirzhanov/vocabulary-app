import { expect, test } from './learner.ts';
import { openFromChatList } from './mentorNav.ts';

/**
 * The mentor section (the owner, 20 November): the chat comes first, on a wide screen the app's
 * sidebar steps aside for the mentor's own, «‹» leads out, and coming back opens the last chat.
 */
test.use({ mentor: true });

test('the chat comes first, alone with its own sidebar, and «‹» leads out', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const appNav = page.getByRole('navigation', { name: 'Разделы' });
  await expect(appNav).toBeVisible();
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Напишите вопрос…' })).toBeVisible();
  await expect(appNav).toBeHidden();
  await page.getByRole('complementary', { name: 'Чаты' }).getByRole('button', { name: 'Назад' }).click();
  await expect(appNav).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
});

test('today’s plan is one tap from the chat, and back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();
  await openFromChatList(page, 'План на сегодня');
  await expect(page.getByRole('heading', { level: 2, name: 'Сейчас' })).toBeVisible();
  await page.getByRole('button', { name: 'Назад' }).first().click();
  await expect(page.getByRole('textbox', { name: 'Напишите вопрос…' })).toBeVisible();
});

test('coming back to the mentor opens the last chat', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Напишите вопрос…' });
  await composer.fill('Помнишь меня?');
  await composer.press('Enter');
  await expect(page.getByRole('button', { name: 'Копировать' })).toBeVisible();

  await page.getByRole('complementary', { name: 'Чаты' }).getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Помнишь меня?' })).toBeVisible();
  await expect(page.getByText('Помнишь меня?', { exact: true }).last()).toBeVisible();

  // And after a reload too: it is kept on the device.
  await page.reload();
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Помнишь меня?' })).toBeVisible();
});
