import { expect, test } from './learner.ts';
import { openFromChatList, openMentorPlan } from './mentorNav.ts';

/**
 * Study, rest, play and priorities (ADR 0076): one tap says what kind of day it is and the plan
 * asks that much; rest, play and sleep are blocks the plan never fills.
 */
test.use({ mentor: true, viewport: { width: 390, height: 844 } });

function afternoon(): Date {
  const d = new Date();
  d.setHours(15, 0, 0, 0);
  return d;
}

const day = (d: Date) => d.toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' });

test('a light day asks less, a sick day nothing, and it can be changed', async ({ page }) => {
  await page.clock.setFixedTime(afternoon());
  await page.goto('/');
  await openMentorPlan(page);
  const check = page.getByRole('region', { name: 'Какой сегодня день?' });
  await expect(check).toBeVisible();
  const tasks = page.getByRole('region', { name: 'План на сегодня' }).getByRole('listitem');
  const before = await tasks.count();
  if (before < 2) test.skip(true, 'a plan of one task has nothing to cut');

  await check.getByRole('button', { name: 'Лёгкий день' }).click();
  await expect(check).toHaveCount(0);
  await expect(page.getByText('Лёгкий день', { exact: true })).toBeVisible();
  await expect.poll(() => tasks.count()).toBeLessThan(before);

  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  await page.getByRole('region', { name: 'Какой сегодня день?' }).getByRole('button', { name: 'Болею' }).click();
  const now = page.getByRole('region', { name: 'Сейчас' });
  await expect(now).toContainText('Выздоравливай. Сегодня ничего не нужно');
  await expect(now.getByRole('button', { name: 'Начать сейчас' })).toHaveCount(0);
});

test('a rest block can be added to the calendar, and study is never placed in it', async ({ page }) => {
  await page.clock.setFixedTime(afternoon());
  await page.request.put('/api/mentor/coach/commitment', {
    data: { weekdays: [0, 1, 2, 3, 4, 5, 6], start_minute: 16 * 60, minutes: 20 },
  });
  await page.request.post('/api/mentor/schedule', {
    data: { title: 'Отдых', kind: 'rest', weekdays: 127, start_minute: 15 * 60, end_minute: 18 * 60 },
  });
  await page.goto('/');
  await openMentorPlan(page);
  // The study time (16:00) falls inside the rest block, so the plan starts after it.
  await expect(page.getByRole('heading', { level: 2, name: 'Сейчас' })).toBeVisible();
  const first = page.getByRole('region', { name: 'План на сегодня' }).getByRole('listitem').first();
  await expect(first).toBeVisible();
  await expect(first).toContainText(/18:[1-5]\d/);

  await page.getByRole('button', { name: 'Спросить наставника…' }).click();
  await openFromChatList(page, 'Моё расписание');
  const today = page.getByRole('region', { name: new RegExp(day(afternoon()), 'i') });
  await today.getByRole('button', { name: /^Отдых/ }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Отдых', pressed: true })).toBeVisible();
});
