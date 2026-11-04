import { DEMO, expect, fakePush, openSettings, test } from './learner.ts';

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

test('a deck with a deadline offers «Напомнить в 17:00»', async ({ page, context, browser }) => {
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
  await page.getByRole('button', { name: 'Напомнить в 17:00' }).click();
  await expect(page.getByText('Напомним в 17:00, если на сегодня останутся слова.')).toBeVisible();
});
