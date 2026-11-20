import type { Page } from '@playwright/test';
import { expect, test } from './learner.ts';

/**
 * When a day is different (ADR 0074): today's plan bends instead of breaking, the calendar knows
 * single dates, and the mentor turns «завтра нет школы» into a change applied on a tap.
 */
test.use({ mentor: true, viewport: { width: 390, height: 844 } });

/** Today at 15:00 on the device, the same calendar day as the server's. */
function afternoon(): Date {
  const d = new Date();
  d.setHours(15, 0, 0, 0);
  return d;
}

const day = (d: Date) => d.toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' });

async function openMentor(page: Page) {
  await page.clock.setFixedTime(afternoon());
  await page.goto('/');
  await page.getByRole('button', { name: 'Наставник', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Сейчас' })).toBeVisible();
}

test('when today doesn’t work, the plan bends to five minutes, and can be undone', async ({ page }) => {
  await page.request.put('/api/mentor/coach/commitment', {
    data: { weekdays: [0, 1, 2, 3, 4, 5, 6], start_minute: 19 * 60, minutes: 20 },
  });
  await openMentor(page);
  const now = page.getByRole('region', { name: 'Сейчас' });
  const cant = now.getByRole('button', { name: 'Сегодня не получается' });
  if (!(await cant.isVisible())) test.skip(true, 'nothing planned for this learner today');
  await cant.click();
  const sheet = page.getByRole('dialog', { name: 'Как поменяем план?' });
  // Each way out shows the day before and after.
  await expect(sheet.getByText('Было').first()).toBeVisible();
  await expect(sheet.getByRole('button', { name: /Перенести на завтра/ })).toBeVisible();
  await sheet.getByRole('button', { name: /Только 5 минут/ }).click();
  await expect(now.getByText('Сегодня — минимум: 5 минут')).toBeVisible();
  const tasks = page.getByRole('region', { name: 'План на сегодня' }).getByRole('listitem');
  await expect(tasks.first()).toContainText(/[1-5] мин/);
  await now.getByRole('button', { name: 'Вернуть как было' }).click();
  await expect(now.getByRole('button', { name: 'Сегодня не получается' })).toBeVisible();
});

test('a block on one date only, and a usual block off for one date', async ({ page }) => {
  await page.request.post('/api/mentor/schedule', {
    data: { title: 'Школа', kind: 'school', weekdays: 127, start_minute: 480, end_minute: 840 },
  });
  await openMentor(page);
  await page.getByRole('button', { name: 'Моё расписание' }).click();
  const today = page.getByRole('region', { name: new RegExp(day(afternoon()), 'i') });

  // Off today only.
  await today.getByRole('button', { name: /^Школа/ }).click();
  await page.getByRole('button', { name: /: не будет$/ }).click();
  await expect(today.getByRole('button', { name: /^Школа/ })).toHaveCount(0);
  const next = new Date(afternoon());
  next.setDate(next.getDate() + 7);
  await page.getByRole('button', { name: 'Следующая неделя' }).click();
  await page.getByRole('button', { name: new RegExp(day(next), 'i') }).click();
  await expect(
    page.getByRole('region', { name: new RegExp(day(next), 'i') }).getByRole('button', { name: /^Школа/ }),
  ).toBeVisible();

  // Something extra on that date only.
  await page.getByRole('button', { name: 'Добавить дело' }).click();
  const form = page.getByRole('dialog');
  await form.getByPlaceholder('Название').fill('Концерт');
  await form.getByRole('checkbox', { name: /^Только / }).check();
  await form.getByRole('button', { name: 'Сохранить' }).click();
  await expect(
    page.getByRole('region', { name: new RegExp(day(next), 'i') }).getByRole('button', { name: /^Концерт/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Предыдущая неделя' }).click();
  await page.getByRole('button', { name: new RegExp(day(afternoon()), 'i') }).click();
  await expect(today.getByRole('button', { name: /^Концерт/ })).toHaveCount(0);
});

test('«завтра нет школы» told to the mentor is applied on the tap, with quick replies', async ({ page }) => {
  await page.request.post('/api/mentor/schedule', {
    data: { title: 'Школа', kind: 'school', weekdays: 127, start_minute: 480, end_minute: 840 },
  });
  await openMentor(page);
  await page.getByRole('button', { name: 'Спросить наставника…' }).click();
  const composer = page.getByRole('textbox', { name: 'Напишите вопрос…' });
  await composer.fill('Завтра нет школы');
  await composer.press('Enter');
  const tomorrow = new Date(afternoon());
  tomorrow.setDate(tomorrow.getDate() + 1);
  const card = page.getByRole('listitem').filter({ hasText: 'не будет' });
  await expect(card).toContainText(`Школа: не будет — ${day(tomorrow)}`);
  // Nothing changed before the tap.
  let events = (await (await page.request.get('/api/mentor/schedule')).json()).events;
  expect(events[0].skipped).toEqual([]);
  await expect(page.getByRole('group', { name: 'Быстрые ответы' }).getByRole('button')).toHaveText([
    'Да, отменить',
    'Нет, всё как обычно',
  ]);
  await card.getByRole('button', { name: 'Применить' }).click();
  await expect(card.getByText('Готово, расписание изменено')).toBeVisible();
  events = (await (await page.request.get('/api/mentor/schedule')).json()).events;
  expect(events[0].skipped).toHaveLength(1);
  // A tap on a quick reply sends it.
  await page.getByRole('group', { name: 'Быстрые ответы' }).getByRole('button', { name: 'Да, отменить' }).click();
  await expect(page.locator('ol').getByText('Да, отменить', { exact: true })).toBeVisible();
});
