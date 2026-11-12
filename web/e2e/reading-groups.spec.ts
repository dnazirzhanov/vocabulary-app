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

test('the giver reads the answers; others see who answered; the giver can take it back', async ({
  page,
  context,
  browser,
}) => {
  const group = await (
    await (await named(context, 'Ольга')).request.post('/api/groups', { data: { name: '7Б' } })
  ).json();
  const masha = await classmate(browser, group.invite_code, 'Маша');
  const given = await (
    await context.request.post('/api/reading-assignments', {
      data: {
        group_id: group.id,
        reading_ref: 'library:tea',
        words: [],
        questions: [
          { kind: 'choice', q: 'What is tea made from?', options: ['Leaves', 'Beans', 'Roots'], answer: 0 },
          { kind: 'open', q: 'Why do people drink tea?', min: 3, max: 50 },
        ],
      },
    })
  ).json();
  const answer = (question: string, fields: Record<string, unknown>) =>
    masha.request.post('/api/sync/push', {
      data: {
        ops: [
          {
            op_id: crypto.randomUUID(),
            kind: 'reading.answer',
            question_ref: question,
            answered_at: new Date().toISOString(),
            ...fields,
          },
        ],
        pulled_at: new Date().toISOString(),
      },
    });
  await answer(given.questions[0].id, { choice: 1 });
  await answer(given.questions[1].id, { text: 'Because it is warm and tasty.' });

  // Olga gave it: Masha's answers, the wrong pick marked.
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await page.getByRole('button', { name: /^От групп/ }).click();
  await page.getByRole('button', { name: /^Tea/ }).click();
  await button(page, 'Ответы группы').click();
  const panel = page.getByRole('dialog', { name: 'Ответы группы' });
  // Me first, then by name; never ranked.
  await expect(panel.getByRole('listitem').first()).toContainText('Ольга');
  const mashaRow = panel.getByRole('button', { name: /^Маша/ });
  await expect(mashaRow).toContainText('Ответы · 2/2 · верно 0/1');
  await mashaRow.click();
  await expect(panel).toContainText('Because it is warm and tasty.');
  await expect(panel).toContainText('Beans');

  // Masha sees who answered how many, not what.
  const mashaPage = await masha.newPage();
  await mashaPage.goto('/');
  await mashaPage.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await mashaPage.getByRole('button', { name: /^От групп/ }).click();
  await mashaPage.getByRole('button', { name: /^Tea/ }).click();
  await button(mashaPage, 'Ответы группы').click();
  const hers = mashaPage.getByRole('dialog', { name: 'Ответы группы' });
  await expect(hers.getByRole('button', { name: /^Маша/ })).toContainText('Ответы · 2/2');
  await expect(hers.getByRole('button', { name: /^Маша/ })).toBeDisabled();
  await expect(hers).not.toContainText('верно');
  await expect(hers.getByRole('button', { name: 'Забрать у группы' })).toHaveCount(0);

  // Olga takes it back: gone from the group.
  await panel.getByRole('button', { name: 'Забрать у группы' }).click();
  await panel.getByRole('button', { name: 'Забрать у группы' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Чтение' })).toBeVisible();
  await mashaPage.reload();
  await mashaPage.getByRole('navigation').getByRole('button', { name: 'Чтение' }).click();
  await expect(mashaPage.getByRole('button', { name: /^От групп/ })).toHaveCount(0);
  await masha.close();
});
