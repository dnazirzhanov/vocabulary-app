import type { Page } from '@playwright/test';
import { DEMO, expect, openSettings, test } from './learner.ts';

// Deadline reminders (ADR 0031). Real delivery needs a push service and the server's keys; here
// the browser's push is a stand-in and the server's key is given, so the test checks the app's
// side: asking once, telling the server, and turning it off again.

const KEY = 'BKt2ZcGWyL1nHxVrBWc05nQd1LgcNTZ8aEZNAWJ3aKAlXU_nO7YWV2HNQo9IRbbmLg4R0KF95W6nLsQqEGa2RWE';

async function fakePush(page: Page) {
  await page.addInitScript(() => {
    let current: { endpoint: string; toJSON: () => object; unsubscribe: () => Promise<boolean> } | null = null;
    const subscription = () => ({
      endpoint: 'https://push.example.com/send/e2e',
      toJSON: () => ({ endpoint: 'https://push.example.com/send/e2e', keys: { p256dh: 'BKey', auth: 'auth' } }),
      unsubscribe: async () => ((current = null), true),
    });
    Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true });
    Notification.requestPermission = async () => 'granted';
    PushManager.prototype.subscribe = async function () {
      current = subscription();
      return current as unknown as PushSubscription;
    };
    PushManager.prototype.getSubscription = async function () {
      return current as unknown as PushSubscription;
    };
  });
  await page.route('**/api/push/key', (route) => route.fulfill({ json: { public_key: KEY } }));
}

test('reminders are turned on once, told to the server, and off again', async ({ page }) => {
  await fakePush(page);
  const told: string[] = [];
  await page.route('**/api/push/subscriptions', (route) => {
    told.push(`${route.request().method()} ${route.request().postDataJSON().endpoint}`);
    return route.fulfill({ status: 204 });
  });
  await page.goto('/');
  await openSettings(page);
  const reminders = page.getByRole('switch', { name: /Напоминания о сроках/ });
  await expect(reminders).not.toBeChecked();
  await expect(
    page.getByText('Вечером, если к сроку учителя на сегодня остались слова.', { exact: false }),
  ).toBeVisible();
  await reminders.click();
  await expect(reminders).toBeChecked();
  await reminders.click();
  await expect(reminders).not.toBeChecked();
  expect(told).toEqual(['POST https://push.example.com/send/e2e', 'DELETE https://push.example.com/send/e2e']);
});

test('a deck with a deadline offers «Напомнить вечером»', async ({ page, context, browser }) => {
  await fakePush(page);
  await page.route('**/api/push/subscriptions', (route) => route.fulfill({ status: 204 }));
  // A teacher (another learner) gives this learner's group a deck due in three days.
  const teacher = await browser.newContext({ extraHTTPHeaders: { ...DEMO, 'X-Dev-User': `e2e-t-${Date.now()}` } });
  await teacher.request.patch('/api/me', { data: { daily_target_words: 5, study_days_per_week: 6 } });
  const group = await (await teacher.request.post('/api/groups', { data: { name: '7Б', nickname: 'Ольга' } })).json();
  const deck = await (await teacher.request.post('/api/decks', { data: { title: 'Unit 9' } })).json();
  for (const headword of ['quill', 'anvil', 'lantern']) {
    await teacher.request.post(`/api/decks/${deck.id}/words`, {
      data: { headword, pos: 'noun', translation: 'слово', example: `A ${headword}.` },
    });
  }
  await context.request.post(`/api/groups/join/${group.invite_code}`, { data: { nickname: 'Анна' } });
  const due = new Date(Date.now() + 3 * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  await teacher.request.post(`/api/decks/${deck.id}/publish`, {
    data: { group_id: group.id, due_on: `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}` },
  });
  await teacher.close();

  await page.goto('/');
  await page.getByRole('button', { name: /^Unit 9/ }).click();
  await page.getByRole('button', { name: 'Напомнить вечером' }).click();
  await expect(page.getByText('Напомним вечером, если на сегодня останутся слова.')).toBeVisible();
});
