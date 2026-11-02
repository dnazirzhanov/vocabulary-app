import { button, DEMO, expect, finishSession, openDeck, test } from './learner.ts';

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
  await expect(page.getByRole('region', { name: 'Сегодня в колоде' })).toContainText(
    'На сегодня всё. Можно взять ещё слов.',
  );

  // Ten more today: the deck's next words, then today reads 18 of 18.
  await page.getByRole('button', { name: 'Ещё слов сегодня' }).click();
  const extra = page.getByRole('dialog', { name: 'Ещё слов сегодня' });
  await expect(extra).toContainText('Завтра снова 8\u00a0слов в день');
  await extra.getByRole('button', { name: '10', exact: true }).click();
  await extra.getByRole('button', { name: 'Начать · 10\u00a0слов' }).click();
  await finishSession(page);
  await button(page, 'На главную').click();
  await expect(page.getByRole('region', { name: 'Сегодня в колоде' })).toContainText(
    'На сегодня всё. Можно взять ещё слов.',
  );
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
  // From the deck's own page, the quiet icon beside the title opens the window (ADR 0036).
  await button(page, 'Дать группе').click();
  const give = page.getByRole('dialog', { name: 'Дать группе' });
  await give.getByLabel('Группа').selectOption({ label: '7Б английский' });
  await give.getByLabel('Выучить к (необязательно)').fill(dueOn);
  await give.getByRole('button', { name: 'Задать' }).click();
  await expect(give.getByRole('list', { name: 'Задано группам' })).toContainText(`выучить к ${dueText}`);
  // Given to its only group: nothing more to offer.
  await expect(give).toContainText('Колода задана всем вашим группам.');
  await page.keyboard.press('Escape');

  // The student: four words over the two days before it, two today.
  const learner = await student.newPage();
  await learner.goto('/');
  await expect(learner.getByRole('region', { name: 'Из моих групп' })).toContainText(
    'до срока 2\u00a0дня, осталось 4\u00a0слова',
  );
  await learner.getByRole('button', { name: /^Unit 5/ }).click();
  await expect(learner.getByRole('note')).toHaveText(
    `Выучить к ${dueText}. Сегодня 2\u00a0слова, чтобы успеть, — последний день останется для повторения.`,
  );
  await expect(button(learner, 'Начать урок · 2 слова')).toBeVisible();

  // Who keeps up (ADR 0030): the student sees only their own standing on the group page…
  await learner.goto('/');
  await learner
    .getByRole('button', { name: /Друзья/ })
    .first()
    .click();
  await learner.getByRole('button', { name: /^7Б английский/ }).click();
  const forClass = learner.getByRole('region', { name: 'К уроку' });
  await expect(forClass).toContainText(`Unit 5 к ${dueText} · ещё не начинали`);
  await expect(learner.getByText(/успевают/)).toHaveCount(0);
  // «Учить» opens the deck to study it.
  await forClass.getByRole('button', { name: 'Учить' }).click();
  await expect(learner.getByRole('heading', { level: 1, name: 'Unit 5' })).toBeVisible();
  // …the teacher sees everyone's, and how many are on track.
  await page.goto('/');
  await page
    .getByRole('button', { name: /Друзья/ })
    .first()
    .click();
  await page.getByRole('button', { name: /^7Б английский/ }).click();
  // …the teacher, how many students keep up, and by name only those who don't: on the first
  // day nobody is behind yet.
  await expect(page.getByRole('region', { name: 'К уроку' })).toContainText(`Unit 5 к ${dueText}: успевают 1 из 1`);
  await expect(page.getByRole('list', { name: 'Не успевают: «Unit 5»' })).toHaveCount(0);
  await student.close();
});
