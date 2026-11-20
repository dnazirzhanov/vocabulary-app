import { expect, type Page } from '@playwright/test';

/** The mentor opens on its chat. */
export async function openMentorChat(page: Page) {
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Напишите вопрос…' })).toBeVisible();
}

/** A page from the chat list (a drawer on phones): today's plan, the schedule, the memory. */
export async function openFromChatList(page: Page, name: string) {
  await expect(page.getByRole('textbox', { name: 'Напишите вопрос…' })).toBeVisible();
  const drawer = page.getByRole('button', { name: 'Чаты', exact: true });
  if (await drawer.isVisible()) await drawer.click();
  await page.getByRole('complementary', { name: 'Чаты' }).getByRole('button', { name }).click();
}

/** Today's plan, one tap from the chat. */
export async function openMentorPlan(page: Page) {
  await openMentorChat(page);
  await openFromChatList(page, 'План на сегодня');
  await expect(page.getByRole('heading', { level: 2, name: 'Сейчас' })).toBeVisible();
}
