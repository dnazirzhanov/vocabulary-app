import { type Browser, type Page } from '@playwright/test';
import { DEMO, expect, named, test } from './learner.ts';

/**
 * A group task's material (ADR 0096): the teacher attaches a deck, an essay question or a speaking
 * question; the student sees it on the task and opens it from there, even where that section isn't
 * open to them yet.
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

async function openTask(page: Page, title: RegExp) {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Планы' }).click();
  const row = page.getByRole('listitem').filter({ hasText: title });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: title }).click();
  return page.getByRole('dialog');
}

test('the teacher attaches a deck; the student opens it from the task', async ({ page, context, browser }) => {
  const group = await (
    await (await named(context, 'Ольга')).request.post('/api/groups', { data: { name: '7Б' } })
  ).json();
  const deck = await (await context.request.post('/api/decks', { data: { title: 'Путешествия' } })).json();
  await context.request.post(`/api/decks/${deck.id}/words`, {
    data: { headword: 'zeppelin', pos: 'noun', translation: 'дирижабль', example: 'The zeppelin is here.' },
  });
  const masha = await student(browser, group.invite_code);

  // The teacher: a task, and «Материал» → Колоды → the deck.
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Друзья' }).click();
  await page.getByRole('button', { name: /^7Б/ }).click();
  const tasks = page.getByRole('region', { name: 'Задачи группы' });
  await tasks.getByRole('button', { name: 'Задача для группы' }).click();
  const box = page.getByRole('textbox', { name: 'Новая задача' });
  await box.fill('Учить новые слова каждый день');
  await page.getByRole('button', { name: 'Материал' }).click();
  await expect(page.getByRole('tab', { name: 'Колоды' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: /^Путешествия/ }).click();
  await expect(page.getByText('Колоды: Путешествия')).toBeVisible();
  await box.press('Enter');
  await page.keyboard.press('Escape');
  await tasks.getByRole('button', { name: /Учить новые слова/ }).click();
  await expect(tasks).toContainText('Путешествия');

  // The student: the material on the task, opened from it.
  const mashaPage = await masha.newPage();
  const view = await openTask(mashaPage, /Учить новые слова/);
  await expect(view).toContainText('Материал');
  await expect(view).toContainText('Путешествия');
  await expect(view).toContainText('Отметится само, когда вы это сделаете');
  await view.getByRole('button', { name: 'Открыть' }).click();
  await expect(mashaPage.getByRole('heading', { level: 1, name: 'Путешествия' })).toBeVisible();
  await masha.close();
});

test('an essay and a speaking question open for a student whose sections are closed', async ({ context, browser }) => {
  const group = await (
    await (await named(context, 'Ольга')).request.post('/api/groups', { data: { name: '7Б' } })
  ).json();
  for (const [title, link] of [
    ['Написать эссе', { kind: 'writing', ref: 'ielts-edu-1' }],
    ['Ответить устно', { kind: 'speaking', ref: 'spon-hometown' }],
  ] as const) {
    const made = await context.request.post(`/api/groups/${group.id}/tasks`, { data: { title, link } });
    expect(made.status(), await made.text()).toBe(201);
  }
  const masha = await student(browser, group.invite_code);
  const mashaPage = await masha.newPage();
  // Not a writing or speaking tester: those tabs aren't hers.
  await mashaPage.goto('/');
  await expect(mashaPage.getByRole('navigation').getByRole('button', { name: 'Письмо' })).toHaveCount(0);

  let view = await openTask(mashaPage, /Написать эссе/);
  await view.getByRole('button', { name: 'Открыть' }).click();
  await expect(mashaPage.getByRole('heading', { level: 1 })).toContainText('education');
  await expect(mashaPage.getByRole('textbox')).toBeVisible();

  view = await openTask(mashaPage, /Ответить устно/);
  await expect(view).toContainText('Речь');
  await view.getByRole('button', { name: 'Открыть' }).click();
  await expect(mashaPage.getByText(/Describe your home city/).first()).toBeVisible();
  await masha.close();
});
