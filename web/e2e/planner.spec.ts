import type { Page } from '@playwright/test';
import { button, expect, finishSession, openDeck, test } from './learner.ts';

/**
 * «Планы» (ADR 0084): a to-do app, TickTick-style. Quick add understands typed dates and repeats;
 * a task is ticked, undone, moved, edited, skipped and deleted; overdue ones wait on top.
 */
test.use({ viewport: { width: 390, height: 844 } });

async function openPlans(page: Page) {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Планы' }).click();
  await expect(page.getByRole('tab', { name: 'Сегодня' })).toHaveAttribute('aria-selected', 'true');
}

async function quickAdd(page: Page, line: string) {
  await page.getByRole('button', { name: 'Новая задача' }).click();
  const box = page.getByRole('textbox', { name: 'Новая задача' });
  await box.fill(line);
  return box;
}

const row = (page: Page, title: string) => page.getByRole('listitem').filter({ hasText: title });
const isoDay = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('a daily study task typed in one line: ticked, undone, and there again tomorrow', async ({ page }) => {
  await openPlans(page);
  await expect(page.getByText('На этот день задач нет')).toBeVisible();
  const box = await quickAdd(page, 'Английский каждый день в 21:00');
  // What the line says is found and shown; the title keeps only its words.
  const dialog = page.getByRole('dialog', { name: 'Новая задача' });
  await expect(dialog.getByRole('button', { name: 'Оставить «каждый день» текстом' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Оставить «в 21:00» текстом' })).toBeVisible();
  await expect(dialog.getByRole('button', { expanded: false }).first()).toContainText('21:00 · Каждый день');
  await box.press('Enter');
  // The sheet stays for the next one, empty.
  await expect(box).toHaveValue('');
  await page.keyboard.press('Escape');

  const task = row(page, 'Английский');
  await expect(task).toContainText('21:00');
  await expect(task).toContainText('Каждый день');
  await task.getByRole('checkbox', { name: 'Выполнить: Английский' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Выполнено' })).toBeVisible();
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(task.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
  await task.getByRole('checkbox').click();
  // Done, it stays in its place, crossed out; the day's only task, so the day is celebrated.
  await expect(task.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  await expect(task).toHaveAttribute('data-done', 'true');
  await expect(page.locator('[data-celebration]')).toBeAttached();

  // Tomorrow it is there again, not done; and it stayed done today after a reload.
  await page.getByRole('group', { name: 'Дата' }).getByRole('button', { name: 'Завтра' }).click();
  await expect(row(page, 'Английский').getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Планы' }).click();
  await expect(row(page, 'Английский').getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
});

test('ticking one of several: it pops with sparks and stays in place; the last one brings confetti', async ({
  page,
}) => {
  await openPlans(page);
  const box = await quickAdd(page, 'Слова в 8:00');
  await box.press('Enter');
  await box.fill('Чтение в 20:00');
  await box.press('Enter');
  await page.keyboard.press('Escape');
  const titles = page.getByRole('region', { name: 'Сегодня', exact: true }).getByRole('listitem');
  await expect(titles).toHaveText([/Слова/, /Чтение/]);

  await row(page, 'Слова').getByRole('checkbox').click();
  await expect(row(page, 'Слова')).toHaveAttribute('data-burst', 'true');
  await expect(page.locator('[data-celebration]')).toHaveCount(0); // one is still left
  // Still first in the list, crossed out, not moved away.
  await expect(titles).toHaveText([/Слова/, /Чтение/]);
  await expect(titles.first()).toHaveAttribute('data-done', 'true');

  await row(page, 'Чтение').getByRole('checkbox').click();
  await expect(page.locator('[data-celebration]')).toBeAttached();
  // The course's words still wait in «Учёба на сегодня»: so not «всё сделано» yet.
  await expect(page.getByRole('region', { name: 'Учёба на сегодня' })).toBeVisible();
  await expect(page.getByText('Всё на сегодня сделано')).toHaveCount(0);
});

test('a task for tomorrow, then «Предстоящие»; edited, then deleted', async ({ page }) => {
  await openPlans(page);
  const box = await quickAdd(page, 'Купить тетрадь завтра');
  await box.press('Enter');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Купить тетрадь')).toHaveCount(0); // not today

  await page.getByRole('tab', { name: 'Предстоящие' }).click();
  await expect(page.getByRole('region', { name: 'Завтра' })).toContainText('Купить тетрадь');

  // Opened: renamed, given a high priority, saved.
  await row(page, 'Купить тетрадь')
    .getByRole('button', { name: /Купить тетрадь/ })
    .click();
  const sheet = page.getByRole('dialog', { name: 'Купить тетрадь' });
  await sheet.getByRole('textbox', { name: 'Название' }).fill('Купить две тетради');
  await sheet.getByRole('radio', { name: 'Высокий' }).click();
  await sheet.getByRole('button', { name: 'Сохранить' }).click();
  const renamed = row(page, 'Купить две тетради');
  await expect(renamed).toBeVisible();
  await expect(renamed.getByRole('checkbox')).toHaveAttribute('data-priority', '3');

  // Deleted from its sheet.
  await renamed.getByRole('button', { name: /Купить две тетради/ }).click();
  await page.getByRole('dialog', { name: 'Купить две тетради' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(row(page, 'Купить две тетради')).toHaveCount(0);
  await expect(page.getByText('Задача удалена')).toBeVisible();
});

test('a repeat skipped for today; a word inside another word is no date', async ({ page }) => {
  await openPlans(page);
  const box = await quickAdd(page, 'Слова по будням в 7:30');
  await box.press('Enter');
  await box.fill('Приготовить завтрак');
  await box.press('Enter');
  await page.keyboard.press('Escape');
  // «завтрак» stays in the title, and the task is today's (the day being looked at).
  await expect(row(page, 'Приготовить завтрак')).toBeVisible();

  const weekday = new Date().getDay() % 6 !== 0;
  if (weekday) {
    await row(page, 'Слова')
      .getByRole('button', { name: /^Слова/ })
      .click();
    await page.getByRole('dialog', { name: 'Слова' }).getByRole('button', { name: 'Пропустить этот день' }).click();
    await expect(row(page, 'Слова')).toHaveCount(0);
  }
});

test('an overdue task waits on top until moved to today', async ({ page }) => {
  await page.goto('/');
  const made = await page.request.post('/api/tasks', { data: { title: 'Сдать эссе', due_on: isoDay(-2) } });
  expect(made.ok()).toBe(true);
  await page.getByRole('navigation').getByRole('button', { name: 'Планы' }).click();
  const overdue = page.getByRole('region', { name: 'Просрочено' });
  await expect(overdue).toContainText('Сдать эссе');
  await overdue.getByRole('button', { name: 'На сегодня' }).click();
  await expect(page.getByRole('region', { name: 'Просрочено' })).toHaveCount(0);
  await expect(row(page, 'Сдать эссе')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the empty day offers a study task; a lesson ticks it «по занятию»', async ({ page }) => {
  await openPlans(page);
  // The example on an empty day: a study task, ready to add.
  await page.getByRole('button', { name: 'Английский каждый день в 21:00' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая задача' });
  await expect(dialog.getByRole('button', { name: /^Занятие в приложении/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('textbox', { name: 'Новая задача' }).press('Enter');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Английский').getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');

  // A lesson in the app, then back: ticked by studying.
  await page.getByRole('navigation').getByRole('button', { name: 'Сегодня' }).click();
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
  await button(page, 'На главную').click();
  await page.getByRole('navigation').getByRole('button', { name: 'Планы' }).click();
  const done = row(page, 'Английский');
  await expect(done.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  await expect(done).toContainText('по занятию');
});

test('Wednesday and Saturday from the day buttons; a time with an end', async ({ page }) => {
  await openPlans(page);
  await expect(page.getByRole('tab', { name: 'Входящие' })).toHaveCount(0);
  const box = await quickAdd(page, 'Бассейн');
  const dialog = page.getByRole('dialog', { name: 'Новая задача' });
  await dialog.getByRole('button', { expanded: false }).first().click();
  const days = dialog.getByRole('group', { name: 'По дням недели' });
  await days.getByRole('button', { name: 'Ср' }).click();
  await days.getByRole('button', { name: 'Сб' }).click();
  await expect(dialog.getByRole('button', { expanded: true })).toContainText('Ср, Сб');
  await box.press('Enter');
  // Typed: from a time to a time.
  await box.fill('Английский с 19:00 до 20:00');
  await box.press('Enter');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Английский')).toContainText('19:00–20:00');

  await page.getByRole('tab', { name: 'Предстоящие' }).click();
  const pool = page.getByRole('listitem').filter({ hasText: 'Бассейн' });
  // On Wednesdays and Saturdays only: two of the next seven days.
  await expect(pool).toHaveCount(2);
  await expect(pool.first()).toContainText('Ср, Сб');
});

test('«Учёба на сегодня»: the app lists the deck to study, and a tap opens it', async ({ page }) => {
  await openPlans(page);
  const studyList = page.getByRole('region', { name: 'Учёба на сегодня' });
  const first = studyList.getByRole('button', { name: /^Учить «/ }).first();
  await expect(first).toBeVisible();
  await expect(first).toContainText(/новых: \d+/);
  const title = (await first.textContent())!.match(/«(.+?)»/)![1];
  await first.click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  // Back: «Планы» again.
  await page
    .getByRole('button', { name: /Назад|Планы/ })
    .first()
    .click();
  await expect(page.getByRole('tab', { name: 'Сегодня' })).toBeVisible();
});
