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

  // «Сейчас» leads with one thing to do (or that the day is done), then the day's checklist.
  await expect(page.getByRole('heading', { level: 2, name: 'Сейчас' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'План на сегодня' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Время занятий' })).toBeVisible();
});

async function openChat(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();
  await page.getByRole('button', { name: 'Спросить наставника…' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /^Чем займёмся/ })).toBeVisible();
}

// ADR 0072: «what should I do now?» runs a tool that shows its step and a card with «Начать
// сейчас», which opens the activity. The server runs in demo mode: the question's words pick the
// tool, so the flow is the real one without a model.
test('asking what to do now shows the mentor checking, then a card that starts it', async ({ page }) => {
  await openChat(page);
  await page.getByRole('button', { name: 'Что мне сейчас делать?' }).click();
  const answer = page.getByRole('listitem').filter({ hasText: 'Смотрю твой план и расписание' });
  await expect(answer.getByRole('status').first()).toHaveText(/Смотрю твой план и расписание$/);
  await expect(answer).toContainText('Загляни в «Сегодня»', { timeout: 10_000 });
  const start = answer.getByRole('button', { name: /Начать сейчас/ });
  // A new learner's first task is a text from the library, or a deck's words.
  await expect(start.or(answer.getByText('На сегодня всё сделано'))).toBeVisible();
  if (await start.isVisible()) {
    await start.click();
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(/Наставник|Чем займёмся/);
  }
});

test('a schedule told to the mentor is shown to confirm, and saved only on the tap', async ({ page }) => {
  await openChat(page);
  const composer = page.getByRole('textbox', { name: 'Напишите вопрос…' });
  await composer.fill('Вот моё расписание: учусь пн–пт 8–14');
  await composer.press('Enter');
  const card = page.getByRole('listitem').filter({ hasText: 'Расписание — проверьте и добавьте' });
  await expect(card.getByRole('checkbox', { name: /Школа/ })).toBeChecked();
  await expect(card).toContainText('Пн, Вт, Ср, Чт, Пт · 08:00–14:00');
  // Nothing in the calendar before the tap.
  expect((await (await page.request.get('/api/mentor/schedule')).json()).events).toEqual([]);
  await card.getByRole('button', { name: 'Добавить в календарь' }).click();
  await expect(card.getByText('Добавлено в календарь')).toBeVisible();
  const saved = (await (await page.request.get('/api/mentor/schedule')).json()).events;
  expect(saved.map((e: { title: string }) => e.title)).toEqual(['Школа']);
});

test('each new chat is kept in the sidebar and opens with its own messages', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openChat(page);
  const composer = page.getByRole('textbox', { name: 'Напишите вопрос…' });
  await composer.fill('Как учить фразовые глаголы?');
  await composer.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Как учить фразовые глаголы?' })).toBeVisible();
  await expect(page.getByText('Загляни в «Сегодня»')).toBeVisible({ timeout: 10_000 });

  // A new chat even while the first answer is still coming in: the first is saved on its own.
  await page.getByRole('button', { name: 'Новый чат' }).first().click();
  await expect(page.getByRole('heading', { level: 2, name: /^Чем займёмся/ })).toBeVisible();
  await composer.fill('А идиомы?');
  await composer.press('Enter');
  await expect(page.getByText('Загляни в «Сегодня»')).toBeVisible({ timeout: 10_000 });

  const chats = page.getByRole('complementary', { name: 'Чаты' });
  await expect(chats.getByRole('button', { name: 'А идиомы?', exact: true })).toBeVisible();
  await chats.getByRole('button', { name: 'Как учить фразовые глаголы?', exact: true }).click();
  await expect(page.locator('ol').getByText('Как учить фразовые глаголы?')).toBeVisible();
  await expect(page.locator('ol').getByText('А идиомы?')).toHaveCount(0);

  // Renamed, then deleted.
  await chats.getByRole('button', { name: /Как учить фразовые глаголы\?.*действия/ }).click();
  const menu = page.getByRole('dialog');
  await menu.getByRole('textbox', { name: 'Название чата' }).fill('Глаголы');
  await menu.getByRole('button', { name: 'Переименовать' }).click();
  await expect(chats.getByRole('button', { name: 'Глаголы', exact: true })).toBeVisible();
  await chats.getByRole('button', { name: /Глаголы.*действия/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить чат' }).click();
  await page.getByRole('dialog', { name: 'Удалить чат?' }).getByRole('button', { name: 'Удалить чат' }).click();
  await expect(chats.getByRole('button', { name: 'Глаголы', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: /^Чем займёмся/ })).toBeVisible();
});

test('on a phone the chats are a drawer, and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openChat(page);
  const chats = page.getByRole('complementary', { name: 'Чаты' });
  await expect(chats).not.toBeInViewport();
  await page.getByRole('button', { name: 'Чаты', exact: true }).click();
  await expect(chats).toBeInViewport();
  // A tap beside the drawer closes it, and so does Escape.
  await page.mouse.click(350, 400);
  await expect(chats).not.toBeInViewport();
  await page.getByRole('button', { name: 'Чаты', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(chats).not.toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the goal chip shows the current goal and «Изменить цель» opens goal setup', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();

  // The fixture set goal='general' so the chip shows the goal label for «Общий».
  await expect(page.getByText('Общий', { exact: false })).toBeVisible();

  // «Изменить цель» opens the GoalSetup screen.
  await page
    .getByRole('button', { name: /Изменить$/ })
    .first()
    .click();
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

// ADR 0071: each task gets a time from the learner's own day: from the promised study time,
// around the schedule. A school day from 08:00 to 22:00 leaves no room until tomorrow.
test("today's tasks get times from the promised study time and the schedule", async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-19T15:00:00'));
  await page.request.put('/api/mentor/coach/commitment', {
    data: { weekdays: [0, 1, 2, 3, 4, 5, 6], start_minute: 19 * 60 + 30, minutes: 20 },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();
  const time = page.getByRole('region', { name: 'Время занятий' });
  await expect(time).toContainText('19:30');
  await expect(time).toContainText('Каждый день · 20 мин');
  const tasks = page.getByRole('region', { name: 'План на сегодня' }).getByRole('listitem');
  if ((await tasks.count()) > 0) await expect(tasks.first()).toContainText('19:30');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
