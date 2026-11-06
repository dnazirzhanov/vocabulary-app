import { expect, fakePush, openSettings, test } from './learner.ts';

// Notifications (ADR 0031, 0042): asking once, telling the server, turning them off, and choosing.

test('reminders are turned on once, told to the server, and off again', async ({ page }) => {
  await fakePush(page);
  const told: string[] = [];
  await page.route('**/api/push/subscriptions', (route) => {
    told.push(`${route.request().method()} ${route.request().postDataJSON().endpoint}`);
    return route.fulfill({ status: 204 });
  });
  await page.goto('/');
  await openSettings(page);
  const reminders = page.getByRole('switch', { name: /^Уведомления/ });
  await expect(reminders).not.toBeChecked();
  await expect(page.getByText(/учител/i)).toHaveCount(0);
  await reminders.click();
  await expect(reminders).toBeChecked();
  await reminders.click();
  await expect(reminders).not.toBeChecked();
  expect(told).toEqual(['POST https://push.example.com/send/e2e', 'DELETE https://push.example.com/send/e2e']);
});

test('which notifications to get is chosen in settings, and stays chosen', async ({ page }) => {
  await fakePush(page);
  await page.route('**/api/push/subscriptions', (route) => route.fulfill({ status: 204 }));
  await page.goto('/');
  await openSettings(page);
  // Nothing to choose until they are on.
  const report = page.getByRole('switch', { name: 'Отчёт группы за вчера' });
  await expect(report).toHaveCount(0);
  await page.getByRole('switch', { name: /^Уведомления/ }).click();
  for (const name of ['Утром: что сегодня по обещанию', 'В 17:00: если сегодня ещё не занимались', 'Срок колоды']) {
    await expect(page.getByRole('switch', { name })).toBeChecked();
  }
  await expect(report).toBeChecked();
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/me') && response.request().method() === 'PATCH',
  );
  await report.click();
  await saved;
  await expect(report).not.toBeChecked();
  const me = await (await page.request.get('/api/me')).json();
  expect(me.notify_report).toBe(false);
  expect(me.notify_morning).toBe(true);
});
