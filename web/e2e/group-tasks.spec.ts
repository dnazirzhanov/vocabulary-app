import { type Browser, type Page } from '@playwright/test';
import { DEMO, expect, named, test } from './learner.ts';

/**
 * A group's to-do list (ADR 0085): the teacher adds a task on the group's page; it appears in the
 * student's «Планы» marked with the group, tick-only; the group's page shows who did it today.
 */
test.use({ viewport: { width: 390, height: 844 } });

async function student(browser: Browser, code: string) {
  const id = `e2e-s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const context = await browser.newContext({
    extraHTTPHeaders: { ...DEMO, 'X-Dev-User': id },
    viewport: { width: 390, height: 844 },
  });
  await context.request.patch('/api/me', { data: { daily_target_words: 5, study_days_per_week: 6 } });
  await (await named(context, 'Маша')).request.post(`/api/groups/join/${code}`);
  return context;
}

async function openGroup(page: Page) {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Друзья' }).click();
  await page.getByRole('button', { name: /^7Б/ }).click();
}

test('the teacher gives a task; the student ticks it in «Планы»; the group sees it done', async ({
  page,
  context,
  browser,
}) => {
  const group = await (
    await (await named(context, 'Ольга')).request.post('/api/groups', { data: { name: '7Б' } })
  ).json();
  const masha = await student(browser, group.invite_code);

  // The teacher: a task for the group, typed in one line.
  await openGroup(page);
  const tasks = page.getByRole('region', { name: 'Задачи группы' });
  await expect(tasks.getByText(/Дайте группе задачу/)).toBeVisible();
  await tasks.getByRole('button', { name: 'Задача для группы' }).click();
  const box = page.getByRole('textbox', { name: 'Новая задача' });
  await box.fill('Повторять слова каждый день в 19:00');
  await box.press('Enter');
  await page.keyboard.press('Escape');
  await expect(tasks).toContainText('Повторять слова');
  await expect(tasks).toContainText('0 из 1 сделали сегодня');

  // The student: in «Планы», marked with the group, ticked; it can't be edited or deleted there.
  const mashaPage = await masha.newPage();
  await mashaPage.goto('/');
  await mashaPage.getByRole('navigation').getByRole('button', { name: 'Планы' }).click();
  const row = mashaPage.getByRole('listitem').filter({ hasText: 'Повторять слова' });
  await expect(row).toContainText('7Б');
  await expect(row).toContainText('19:00');
  await row.getByRole('button', { name: /^Повторять слова/ }).click();
  const sheet = mashaPage.getByRole('dialog', { name: 'Повторять слова' });
  await expect(sheet.getByText('Задача группы 7Б')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Удалить' })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Сохранить' })).toHaveCount(0);
  await mashaPage.keyboard.press('Escape');
  await row.getByRole('checkbox', { name: 'Выполнить: Повторять слова' }).click();
  await expect(row.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');

  // The teacher sees it: «1 из 1», and Masha's dot for today filled.
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Друзья' }).click();
  await page.getByRole('button', { name: /^7Б/ }).click();
  await expect(tasks).toContainText('1 из 1 сделали сегодня');
  await tasks.getByRole('button', { name: /Повторять слова/ }).click();
  const today = tasks.getByRole('listitem').filter({ hasText: 'Маша' });
  await expect(today.locator('[data-today]')).toHaveAttribute('data-state', 'done');
  await masha.close();
});
