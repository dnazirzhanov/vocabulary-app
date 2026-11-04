import { button, expect, finishSession, openDeck, test } from './learner.ts';

// The promise (ADR 0039): chosen weekdays, a change that starts tomorrow, a pause, and a group
// report of who kept it. The server clock is fixed so every day is known.
const MONDAY = new Date('2026-11-02T09:00:00Z');
const TUESDAY = new Date('2026-11-03T09:00:00Z');
const WEDNESDAY = new Date('2026-11-04T09:00:00Z');

test('a learner changes the promise, which starts tomorrow once a lesson is done, and pauses it', async ({
  page,
  learner,
}) => {
  await learner.travelTo(MONDAY);
  await page.goto('/');
  await button(page, 'Прогресс').click();
  await expect(page.getByText(/Обещание: Пн–Сб/)).toBeVisible();

  // Nothing is finished yet, so a change applies at once.
  await button(page, 'Изменить').click();
  const dialog = page.getByRole('dialog', { name: 'Моё обещание' });
  await dialog.getByRole('button', { name: 'Пн–Пт' }).click();
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Сохранено: Пн–Пт');
  await page.keyboard.press('Escape');
  await expect(page.getByText(/Обещание: Пн–Пт/)).toBeVisible();
  await expect(page.getByText('0 из 5 дней на этой неделе')).toBeVisible();

  // After a lesson the past is protected: a change starts tomorrow, and today still reads as before.
  await button(page, 'Сегодня').click();
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
  await button(page, 'На главную').click();
  await button(page, 'Прогресс').click();
  await button(page, 'Изменить').click();
  await dialog.getByRole('button', { name: 'Каждый день' }).click();
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Сохранено: каждый день');
  await page.keyboard.press('Escape');
  await expect(page.getByText(/Обещание: Пн–Пт/)).toBeVisible();
  await learner.travelTo(TUESDAY);
  await page.reload();
  await button(page, 'Прогресс').click();
  await expect(page.getByText(/Обещание: каждый день/)).toBeVisible();

  // A pause starts tomorrow and can be dropped; its days are not promised.
  await button(page, 'Изменить').click();
  await dialog.getByLabel('Пауза до').fill('2026-11-06');
  await dialog.getByRole('button', { name: 'Поставить паузу' }).click();
  await expect(dialog).toContainText('Пауза с 4 ноября по 6 ноября.');
  await dialog.getByRole('button', { name: 'Снять паузу' }).click();
  await expect(dialog.getByLabel('Пауза до')).toBeVisible();
});

test('the group report shows a missed promise, and a paused one is not missed', async ({
  page,
  context,
  browser,
  learner,
}) => {
  await learner.travelTo(MONDAY);
  const group = await (
    await context.request.post('/api/groups', { data: { name: '7Б английский', nickname: 'Ольга' } })
  ).json();
  // Two friends join on Monday and promise every day; Борис pauses until Friday, from tomorrow.
  for (const [user, nickname, pause] of [
    ['anna', 'Анна', false],
    ['boris', 'Борис', true],
  ] as const) {
    const friend = await browser.newContext({
      extraHTTPHeaders: { 'X-Dev-User': `e2e-${user}-${Date.now()}`, 'X-Dev-Now': MONDAY.toISOString() },
    });
    await friend.request.patch('/api/me', { data: { daily_target_words: 3, study_days_per_week: 7 } });
    await friend.request.post(`/api/groups/join/${group.invite_code}`, { data: { nickname } });
    if (pause) await friend.request.put('/api/me/promise/pause', { data: { until: '2026-11-06' } });
    await friend.close();
  }

  // Tuesday: Ольга studies; Анна does not.
  await learner.travelTo(TUESDAY);
  await page.goto('/');
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
  await button(page, 'На главную').click();

  // Wednesday morning, in the group: Tuesday is over.
  await learner.travelTo(WEDNESDAY);
  await page.goto('/');
  await button(page, 'Друзья').click();
  await page.getByRole('button', { name: /^7Б английский/ }).click();
  // Names by today's promise: nobody has studied yet, Борис is paused.
  await expect(page.getByRole('region', { name: 'Сделали сегодня' })).toHaveCount(0);
  const open = page.getByRole('region', { name: 'Ещё нет' });
  await expect(open.getByRole('button', { name: /^Ольга.*пропусков: 0/ })).toBeVisible();
  await expect(open.getByRole('button', { name: /^Анна.*пропусков: 1/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Сегодня выходной' })).toContainText('Борис');
  await expect(page.getByRole('region', { name: 'Сегодня выходной' })).toContainText('пропусков: 0');
  await expect(page.getByText('Вы: ещё нет')).toBeVisible();
  // Me first, then alphabetically: no score orders the friends.
  const names = await open.getByRole('button').allInnerTexts();
  expect(names.map((text) => text.split('\n')[0])).toEqual(['Ольга', 'Анна']);
  // A friend's window has their week: Анна joined Monday, so Tuesday is the first she could miss.
  await open.getByRole('button', { name: /^Анна/ }).click();
  const window = page.getByRole('dialog', { name: 'Анна' });
  await expect(window.getByRole('img', { name: /Пн — не по обещанию, Вт — пропущено/ })).toBeVisible();
});
