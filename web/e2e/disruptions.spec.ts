import type { Page } from '@playwright/test';
import { expect, test } from './learner.ts';
import { openFromChatList, openMentorPlan } from './mentorNav.ts';

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
  await openMentorPlan(page);
}

test('when today doesn’t work: five minutes at the planned time, another real time, or rest', async ({ page }) => {
  // The owner's case (20 November): Budapest, 14:25, studying at 21:00.
  await page.request.put('/api/mentor/coach/commitment', {
    data: { weekdays: [0, 1, 2, 3, 4, 5, 6], start_minute: 21 * 60, minutes: 20 },
  });
  const d = new Date();
  d.setHours(14, 25, 0, 0);
  await page.clock.setFixedTime(d);
  await page.goto('/');
  await openMentorPlan(page);
  const now = page.getByRole('region', { name: 'Сейчас' });
  const cant = now.getByRole('button', { name: 'Сегодня не получается' });
  if (!(await cant.isVisible())) test.skip(true, 'nothing planned for this learner today');
  await cant.click();
  const sheet = page.getByRole('dialog', { name: 'Как поменяем план?' });
  // The minimum keeps the planned 21:00, not «now».
  await expect(sheet.getByRole('button', { name: /Только 5 минут/ })).toContainText('в 21:00');
  // Other times are real ones, earlier and later than 21:00, never «later» that is earlier.
  const times = await sheet.getByRole('region', { name: 'Другое время' }).getByRole('button').allTextContents();
  const minutes = times
    .filter((x) => /^\d\d:\d\d$/.test(x))
    .map((x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3)));
  expect(minutes.some((m) => m < 21 * 60) && minutes.some((m) => m > 21 * 60)).toBe(true);
  expect(minutes.every((m) => m >= 14 * 60 + 30)).toBe(true);
  await expect(sheet.getByRole('button', { name: /Сегодня отдыхаю/ })).toContainText('без двойной нагрузки');

  const later = minutes.find((m) => m > 21 * 60)!;
  const label = `${String(Math.floor(later / 60)).padStart(2, '0')}:${String(later % 60).padStart(2, '0')}`;
  await sheet.getByRole('button', { name: label, exact: true }).click();
  await expect(now.getByText(`Сегодня — с ${label}`)).toBeVisible();
  const tasks = page.getByRole('region', { name: 'План на сегодня' }).getByRole('listitem');
  await expect(tasks.first()).toContainText(label);
  await now.getByRole('button', { name: 'Вернуть как было' }).click();
  await expect(now.getByRole('button', { name: 'Сегодня не получается' })).toBeVisible();
});

test('a choice made for one day is not shown on the next', async ({ page }) => {
  await page.request.put('/api/mentor/coach/today', { data: { mode: 'skip' } });
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  await page.clock.setFixedTime(tomorrow); // the device is already in tomorrow
  await page.goto('/');
  await openMentorPlan(page);
  await expect(page.getByText('Сегодня — отдых', { exact: false })).toHaveCount(0);
});

test('a block on one date only, and a usual block off for one date', async ({ page }) => {
  await page.request.post('/api/mentor/schedule', {
    data: { title: 'Школа', kind: 'school', weekdays: 127, start_minute: 480, end_minute: 840 },
  });
  await openMentor(page);
  await page.getByRole('button', { name: 'Спросить наставника…' }).click();
  await openFromChatList(page, 'Моё расписание');
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
