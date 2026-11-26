import { type Browser, type Page } from '@playwright/test';
import { DEMO, expect, named, test } from './learner.ts';

/**
 * A group's to-do list (ADR 0085): the teacher adds a task on the group's page; it appears in the
 * student's «Планы» marked with the group, tick-only; the group's page shows who did it today.
 */
test.use({ viewport: { width: 390, height: 844 } });

async function student(browser: Browser, code: string, name = 'Маша') {
  const id = `e2e-s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const context = await browser.newContext({
    extraHTTPHeaders: { ...DEMO, 'X-Dev-User': id },
    viewport: { width: 390, height: 844 },
  });
  await context.request.patch('/api/me', { data: { daily_target_words: 5, study_days_per_week: 6 } });
  await (await named(context, name)).request.post(`/api/groups/join/${code}`);
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
  const petya = await student(browser, group.invite_code, 'Петя');

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
  await expect(tasks).toContainText('0 из 2 сделали сегодня');

  // The student: in «Планы», marked with the group, ticked; it can't be edited or deleted there.
  const mashaPage = await masha.newPage();
  await mashaPage.goto('/');
  await mashaPage.getByRole('navigation').getByRole('button', { name: 'Планы' }).click();
  const row = mashaPage.getByRole('listitem').filter({ hasText: 'Повторять слова' });
  await expect(row).toContainText('7Б');
  await expect(row).toContainText('19:00');
  // Tapped: what it is, from which group, when and on which days, and my week on it. Nothing to edit.
  await row.getByRole('button', { name: /^Повторять слова/ }).click();
  const view = mashaPage.getByRole('dialog', { name: 'Повторять слова' });
  await expect(view.getByText('Задача группы 7Б')).toBeVisible();
  await expect(view).toContainText('Когда');
  await expect(view).toContainText('19:00 · Каждый день');
  await expect(view).toContainText('Моя неделя');
  await expect(view).toContainText('Сделано: 0 из 1');
  await expect(view.getByRole('textbox')).toHaveCount(0);
  await expect(view.getByRole('button', { name: 'Удалить' })).toHaveCount(0);
  await expect(view.getByRole('button', { name: 'Сохранить' })).toHaveCount(0);
  // Marked done right there; my week follows.
  await view.getByRole('button', { name: 'Отметить выполненной' }).click();
  await expect(view).toContainText('Сделано: 1 из 1');
  await expect(view.getByRole('button', { name: 'Вернуть' })).toBeVisible();
  // No «Отменить» notice over the view: «Вернуть» is right there.
  await expect(mashaPage.getByRole('status').filter({ hasText: 'Выполнено' })).toHaveCount(0);
  await mashaPage.keyboard.press('Escape');
  await expect(row.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');

  // On the group's page Masha sees her own week on the task, not her classmates'.
  await mashaPage.getByRole('navigation').getByRole('button', { name: 'Друзья' }).click();
  await mashaPage.getByRole('button', { name: /^7Б/ }).click();
  const hers = mashaPage.getByRole('region', { name: 'Задачи группы' });
  await hers.getByRole('button', { name: /Повторять слова/ }).click();
  await expect(hers).toContainText('Маша');
  await expect(hers).not.toContainText('Петя');
  await expect(hers.getByRole('button', { name: 'Удалить задачу' })).toHaveCount(0);

  // The teacher sees it: «1 из 2», and Masha's dot for today filled.
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Друзья' }).click();
  await page.getByRole('button', { name: /^7Б/ }).click();
  await expect(tasks).toContainText('1 из 2 сделали сегодня');
  await tasks.getByRole('button', { name: /Повторять слова/ }).click();
  const today = tasks.getByRole('listitem').filter({ hasText: 'Маша' }).filter({ hasNotText: 'Петя' });
  await expect(today.locator('[data-today]')).toHaveAttribute('data-state', 'done');
  // The teacher follows everyone.
  await expect(tasks).toContainText('Петя');
  await masha.close();
  await petya.close();
});
