import { type Browser, type BrowserContext } from '@playwright/test';
import { button, DEMO, expect, named, test } from './learner.ts';

// A reading given to a group (round 2, D): one screen for the giver — group, deadline, words,
// questions — and the members find it under «От групп», its words to learn and its questions to
// answer, in one place instead of a photo in the chat and words sent separately.

test.use({ reader: true });

/** Another reader (the e2e API lists e2e-reader-* as testers) who joined the group. */
async function classmate(browser: Browser, code: string, name: string): Promise<BrowserContext> {
  const id = `e2e-reader-m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const context = await browser.newContext({ extraHTTPHeaders: { ...DEMO, 'X-Dev-User': id } });
  await context.request.patch('/api/me', {
    data: { language: 'ru', daily_target_words: 5, study_days_per_week: 6 },
  });
  await (await named(context, name)).request.post(`/api/groups/join/${code}`);
  return context;
}

test('a reading given with its words and questions reaches the group in one step', async ({
  page,
  context,
  browser,
}) => {
  const group = await (
    await (await named(context, 'Ольга')).request.post('/api/groups', { data: { name: '7Б' } })
  ).json();
  const masha = await classmate(browser, group.invite_code, 'Маша');

  // Olga, at the end of Tea: «Дать группе».
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await page.getByRole('button', { name: /^Культура/ }).click();
  await page.getByRole('button', { name: /^Tea/ }).click();
  await button(page, 'Дать группе').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Дать группе' })).toBeVisible();
  // Her only group is picked already; one word chosen; one question changed, one dropped.
  await expect(button(page, '7Б')).toHaveAttribute('aria-pressed', 'true');
  await button(page, 'leaf').click();
  await expect(page.getByText('Выбрано: 1')).toBeVisible();
  await page.getByRole('textbox', { name: 'Вопросы к тексту 4' }).fill('Why do you drink tea, or why not?');
  await page.getByRole('spinbutton', { name: 'Слов от' }).first().fill('10');
  await page.getByRole('button', { name: 'Убрать вопрос 5' }).click();
  await page.getByRole('main').getByRole('button', { name: 'Дать группе', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(/Готово: текст у группы «7Б»/);

  // Masha finds it under «От групп», from Olga.
  const mashaPage = await masha.newPage();
  await mashaPage.goto('/');
  await mashaPage.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await mashaPage.getByRole('button', { name: /^От групп/ }).click();
  const row = mashaPage.getByRole('button', { name: /^Tea/ });
  await expect(row).toContainText('от Ольга · 7Б');
  await row.click();
  await expect(mashaPage.getByRole('heading', { level: 1, name: 'Tea' })).toBeVisible();
  await expect(mashaPage.getByText('от Ольга · 7Б')).toBeVisible();
  await expect(button(mashaPage, 'Слова к тексту · 1 · Учить')).toBeVisible();

  // Its questions are Olga's: three with options, then her changed one; the fifth dropped.
  const questions = mashaPage.getByRole('region', { name: 'Вопросы к тексту' });
  await expect(questions.getByRole('listitem')).toHaveCount(4);
  await expect(questions.getByRole('listitem').nth(3)).toContainText('Why do you drink tea, or why not?');
  await questions.getByRole('textbox').fill('I drink green tea every morning with my family.');
  await expect(questions.getByText('9 / 10–150 слов')).toBeVisible();
  await questions.getByRole('textbox').fill('I drink green tea every morning with my whole family.');
  await questions.getByRole('button', { name: 'Отправить' }).click();
  await expect(questions.getByRole('listitem').nth(3)).toContainText('every morning with my whole family');

  // Its word is a deck under «Из чтения» on Masha's home.
  await mashaPage.getByRole('button', { name: 'Назад' }).click();
  await mashaPage.getByRole('navigation').getByRole('button', { name: 'Сегодня' }).click();
  await mashaPage.getByRole('button', { name: /^Из чтения/ }).click();
  await expect(mashaPage.getByRole('button', { name: /^Tea/ })).toContainText('1 слово');
  await masha.close();
});

test('with no group yet, «Дать группе» says how to get one', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await page.getByRole('button', { name: /^Культура/ }).click();
  await page.getByRole('button', { name: /^Tea/ }).click();
  await button(page, 'Дать группе').click();
  await expect(page.getByText(/Чтобы дать текст группе, сначала вступите в группу/)).toBeVisible();
});
