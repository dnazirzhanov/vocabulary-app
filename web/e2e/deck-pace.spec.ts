import { button, DEMO, expect, finishSession, openDeck, test, named } from './learner.ts';

// New words a day per deck, more words today, and a teacher's deadline (ADR 0028).

test('a deck’s new words a day change in place, and extra words are for today only', async ({ page }) => {
  await page.goto('/');
  await openDeck(page);
  await expect(page.getByText(/^В день: 5\u00a0новых слов/)).toContainText('для всего курса');

  // Two taps to change it: «Изменить», then the number.
  await page.getByRole('button', { name: 'Изменить число новых слов в день' }).click();
  for (let n = 0; n < 3; n += 1) await page.getByRole('button', { name: 'Больше' }).click();
  await expect(page.getByLabel('Слов в день', { exact: true })).toHaveValue('8');
  await button(page, 'Сохранить').click();
  await expect(page.getByText(/^В день: 8\u00a0новых слов/)).toBeVisible();
  await button(page, 'Начать урок · 8 слов').click();
  await finishSession(page);
  await button(page, 'На главную').click();
  await expect(button(page, 'Ещё 5 слов')).toBeVisible(); // today's words are done: a bonus lesson

  // Ten more today: the deck's next words, then today reads 18 of 18.
  await page.getByRole('button', { name: 'Ещё слов сегодня' }).click();
  const extra = page.getByRole('dialog', { name: 'Ещё слов сегодня' });
  await expect(extra).toContainText('Завтра снова 8\u00a0слов в день');
  await extra.getByRole('button', { name: '10', exact: true }).click();
  await extra.getByRole('button', { name: 'Начать · 10\u00a0слов' }).click();
  await finishSession(page);
  await button(page, 'На главную').click();
  await expect(button(page, 'Ещё 5 слов')).toBeVisible(); // today's words are done: a bonus lesson
});

test('a teacher’s «Выучить к» spreads a deck over the days before it', async ({ page, context, browser }) => {
  const group = await (
    await (await named(context, 'Ольга')).request.post('/api/groups', { data: { name: '7Б английский' } })
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
  await (await named(student, 'Анна')).request.post(`/api/groups/join/${group.invite_code}`);

  // The teacher gives it with a deadline two days ahead.
  const due = new Date();
  due.setDate(due.getDate() + 2);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dueOn = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`;
  const dueText = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' }).format(due);
  await page.goto('/');
  await page.getByRole('button', { name: /^Unit 5/ }).click();
  // From the deck's own page, the quiet icon beside the title opens the window (ADR 0036).
  await button(page, 'Дать группе').click();
  const give = page.getByRole('dialog', { name: 'Дать группе' });
  // Given in one tap, then a deadline on its own line (ADR 0049).
  await give.getByRole('button', { name: 'Дать группе «7Б английский»' }).click();
  const deadline = give.getByLabel('Срок для группы «7Б английский»');
  await deadline.fill(dueOn);
  await expect(give.getByText(`К ${dueText}`)).toBeVisible();
  // It can be taken off again, and put back.
  await give.getByRole('button', { name: 'Убрать срок для группы «7Б английский»' }).click();
  await expect(give.getByText('Указать срок')).toBeVisible();
  await deadline.fill(dueOn);
  await expect(give.getByText(`К ${dueText}`)).toBeVisible();
  // Given to its only group: no more «Дать» to offer.
  await expect(give.getByRole('button', { name: /^Дать группе/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // The deck's page says where it is, on the same labelled button as the editor's card.
  await expect(button(page, 'В группе «7Б английский»')).toBeVisible();

  // The student: four words over the two days before it, two today.
  const learner = await student.newPage();
  await learner.goto('/');
  await expect(learner.getByRole('region', { name: 'Из моих групп' })).toContainText(
    'до срока 2\u00a0дня, осталось 4\u00a0слова',
  );
  await learner.getByRole('button', { name: /^Unit 5/ }).click();
  // The button says what today asks for, and no sentence repeats it (ADR 0051).
  await expect(button(learner, 'Начать урок · 2 слова')).toBeVisible();
  await expect(learner.locator('main')).not.toContainText('Выучить к');

  // Nobody is told who keeps up with it (ADR 0054): neither the student nor the teacher.
  for (const someone of [learner, page]) {
    await someone.goto('/');
    await someone
      .getByRole('button', { name: /Друзья/ })
      .first()
      .click();
    const group = someone.getByRole('button', { name: /^7Б английский/ });
    await expect(group).toBeVisible();
    await expect(someone.locator('main')).not.toContainText(/отста|успева/);
    await group.click();
    await expect(someone.getByRole('heading', { level: 1, name: '7Б английский' })).toBeVisible();
    await expect(someone.getByRole('region', { name: 'К уроку' })).toHaveCount(0);
    await expect(someone.locator('main')).not.toContainText(/К уроку|отста|успева/);
  }
  await student.close();
});
