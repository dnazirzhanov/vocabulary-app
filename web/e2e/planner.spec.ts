import type { Page } from '@playwright/test';
import { expect, test } from './learner.ts';

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
  await expect(page.getByRole('button', { name: 'Выполнено · 1' })).toBeVisible();

  // Tomorrow it is there again, not done; and it stayed done today after a reload.
  await page.getByRole('group', { name: 'Дата' }).getByRole('button', { name: 'Завтра' }).click();
  await expect(row(page, 'Английский').getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Планы' }).click();
  await expect(page.getByRole('button', { name: 'Выполнено · 1' })).toBeVisible();
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
  let box = await quickAdd(page, 'Слова по будням в 7:30');
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
  // A plain task with no date: «Входящие».
  await page.getByRole('tab', { name: 'Входящие' }).click();
  box = await quickAdd(page, 'Посмотреть фильм на английском');
  await box.press('Enter');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Посмотреть фильм на английском')).toBeVisible();
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
