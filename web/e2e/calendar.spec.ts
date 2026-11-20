import type { Page } from '@playwright/test';
import { expect, test } from './learner.ts';
import { openFromChatList, openMentorChat } from './mentorNav.ts';

/**
 * The week the mentor plans around (ADR 0073): filled from a template or by telling the mentor,
 * exact (overlapping blocks side by side, times to the minute), and changed by dragging.
 */
test.use({ mentor: true, viewport: { width: 390, height: 844 } });

// A Thursday afternoon, so «today» is fixed.
const THURSDAY = new Date('2026-11-19T15:00:00');

async function openCalendar(page: Page) {
  await page.clock.setFixedTime(THURSDAY);
  await page.goto('/');
  await openMentorChat(page);
  await openFromChatList(page, 'Моё расписание');
  await expect(page.getByRole('heading', { level: 1, name: 'Моё расписание' })).toBeVisible();
}

const today = (page: Page) => page.getByRole('region', { name: /четверг, 19 ноября/i });

test('an empty week starts from a template, previewed before it is added', async ({ page }) => {
  await openCalendar(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Расскажите о своей неделе' })).toBeVisible();
  await page.getByRole('button', { name: 'Школьник' }).click();
  const preview = page.getByRole('dialog', { name: 'Школьник' });
  await expect(preview).toContainText('Школа · Пн–Пт · 08:00–14:00');
  await preview.getByRole('button', { name: 'Добавить' }).click();
  await expect(today(page).getByRole('button', { name: 'Школа, 08:00–14:00' })).toBeVisible();
  // The strip marks the days that have something; the weekend is free.
  await expect(page.getByRole('button', { name: /пятница, 20 ноября/i }).locator('span[data-on]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /суббота, 21 ноября/i }).locator('span[data-on]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('blocks at the same time sit side by side, never on top of each other', async ({ page }) => {
  for (const [title, start, end] of [
    ['Школа', 480, 840],
    ['Кружок', 780, 900],
  ] as const) {
    await page.request.post('/api/mentor/schedule', {
      data: { title, kind: 'school', weekdays: 31, start_minute: start, end_minute: end },
    });
  }
  await openCalendar(page);
  const school = await today(page)
    .getByRole('button', { name: /^Школа/ })
    .boundingBox();
  const club = await today(page)
    .getByRole('button', { name: /^Кружок/ })
    .boundingBox();
  expect(school && club).toBeTruthy();
  // Side by side: the club starts where the school ends, across.
  expect(club!.x).toBeGreaterThanOrEqual(school!.x + school!.width - 1);
  // Heights true to the minute: 6 hours against 2 hours.
  expect(school!.height / club!.height).toBeCloseTo(3, 1);
});

test('telling the mentor about the week turns into blocks after the tap', async ({ page }) => {
  await openCalendar(page);
  await page.getByRole('textbox', { name: 'Расскажите о своей неделе' }).fill('учусь пн–пт 8–14');
  await page.getByRole('button', { name: 'Отправить наставнику' }).click();
  const card = page.getByRole('listitem').filter({ hasText: 'Расписание — проверьте и добавьте' });
  await card.getByRole('button', { name: 'Добавить в календарь' }).click();
  await expect(card.getByText('Добавлено в календарь')).toBeVisible();
  await page.getByRole('button', { name: 'Чаты', exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Чаты' })
    .getByRole('button', { name: 'Моё расписание', exact: true })
    .click();
  await expect(today(page).getByRole('button', { name: 'Школа, 08:00–14:00' })).toBeVisible();
});

test('dragging a block moves it by quarter hours, and the change is saved', async ({ page }) => {
  await page.request.post('/api/mentor/schedule', {
    data: { title: 'Спорт', kind: 'sport', weekdays: 127, start_minute: 17 * 60, end_minute: 18 * 60 },
  });
  await openCalendar(page);
  const block = today(page).getByRole('button', { name: /^Спорт/ });
  await block.scrollIntoViewIfNeeded();
  const box = (await block.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 10 + 28, { steps: 4 }); // half an hour
  await page.mouse.move(box.x + box.width / 2, box.y + 10 + 56, { steps: 4 }); // an hour
  await page.mouse.up();
  await expect(today(page).getByRole('button', { name: 'Спорт, 18:00–19:00' })).toBeVisible();
  await expect
    .poll(async () => (await (await page.request.get('/api/mentor/schedule')).json()).events[0].start_minute)
    .toBe(18 * 60);
});

test('on a wide screen the whole week shows at once', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openCalendar(page);
  await expect(page.getByRole('region', { name: /понедельник, 16 ноября/i })).toBeVisible();
  await expect(page.getByRole('region', { name: /воскресенье, 22 ноября/i })).toBeVisible();
});
