import { button, DEMO, expect, finishSession, openDeck, test } from './learner.ts';

// New words a day per deck, more words today, and a teacher's deadline (ADR 0028).

test('a deck’s new words a day change in place, and extra words are for today only', async ({ page }) => {
  await page.goto('/');
  await openDeck(page);
  await expect(page.getByText(/^Новых слов в день: 5/)).toContainText('для всего курса');

  // Two taps to change it: «Изменить», then the number.
  await page.getByRole('button', { name: 'Изменить число новых слов в день' }).click();
  for (let n = 0; n < 3; n += 1) await page.getByRole('button', { name: 'Больше' }).click();
  await expect(page.getByLabel('Слов в день', { exact: true })).toHaveValue('8');
  await button(page, 'Сохранить').click();
  await expect(page.getByText(/^Новых слов в день: 8/)).toBeVisible();
  await button(page, 'Начать урок · 8 слов').click();
  await finishSession(page);
  await button(page, 'На главную').click();
  await expect(page.getByText(/^Новых слов в день: 8/)).toContainText('сегодня 8 из 8');

  // Ten more today: the deck's next words, then today reads 18 of 18.
  await page.getByRole('button', { name: 'Ещё слов сегодня' }).click();
  const extra = page.getByRole('dialog', { name: 'Ещё слов сегодня' });
  await expect(extra).toContainText('Завтра снова 8\u00a0слов в день');
  await extra.getByRole('button', { name: '10', exact: true }).click();
  await extra.getByRole('button', { name: 'Начать · 10\u00a0слов' }).click();
  await finishSession(page);
  await button(page, 'На главную').click();
  await expect(page.getByText(/^Новых слов в день: 8/)).toContainText('сегодня 18 из 18 (+10 сверх)');
});

test('a teacher’s «Выучить к» spreads a deck over the days before it', async ({ page, context, browser }) => {
  const group = await (
    await context.request.post('/api/groups', { data: { name: '7Б английский', nickname: 'Ольга' } })
  ).json();
  const deck = await (await context.request.post('/api/decks', { data: { title: 'Unit 5' } })).json();
  for (const headword of ['quill', 'anvil', 'lantern', 'harbor']) {
    await context.request.post(`/api/decks/${deck.id}/words`, {
      data: { headword, pos: 'noun', translation: 'слово', example: `A ${headword}.` },
    });
  }
  const student = await browser.newContext({
    extraHTTPHeaders: { ...DEMO, 'X-Dev-User': `e2e-student-${Date.now().toString(36)}` },
  });
  // A slow pace: one new word a day would not be in time.
  await student.request.patch('/api/me', { data: { daily_target_words: 1, study_days_per_week: 6 } });
  await student.request.post(`/api/groups/join/${group.invite_code}`, { data: { nickname: 'Анна' } });

  // The teacher gives it with a deadline two days ahead.
  const due = new Date();
  due.setDate(due.getDate() + 2);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dueOn = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`;
  const dueText = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' }).format(due);
  await page.goto('/');
  await page.getByRole('button', { name: /^Unit 5/ }).click();
  await page.getByRole('button', { name: /^Изменить колоду/ }).click();
  await page.getByLabel('Дать группе').selectOption({ label: '7Б английский' });
  await page.getByLabel('Выучить к (необязательно)').fill(dueOn);
  await button(page, 'Задать').click();
  await expect(page.getByRole('list', { name: 'Задано группам' })).toContainText(`выучить к ${dueText}`);

  // The student: four words over the two days before it, two today.
  const learner = await student.newPage();
  await learner.goto('/');
  await expect(learner.getByRole('region', { name: 'Из моих групп' })).toContainText(`выучить к ${dueText}`);
  await learner.getByRole('button', { name: /^Unit 5/ }).click();
  await expect(learner.getByRole('note')).toHaveText(
    `Выучить к ${dueText}. Сегодня 2\u00a0слова, чтобы успеть, — последний день останется для повторения.`,
  );
  await expect(button(learner, 'Начать урок · 2 слова')).toBeVisible();
  await student.close();
});
