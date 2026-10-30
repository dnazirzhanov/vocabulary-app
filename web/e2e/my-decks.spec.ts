import { button, DEMO, expect, finishSession, test } from './learner.ts';

// «Мои колоды» (ADR 0019): a deck of one's own from «Сегодня», cards made from words with AI
// (demo provider here), studied by opening the deck.
test('a learner makes a deck from words and studies it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Мои колоды' })).toBeFocused();
  await page.getByRole('button', { name: /^Создать колоду/ }).click();
  await page.getByLabel('Название новой колоды').fill('Путешествия');
  await button(page, 'Создать').click();

  // Quick add: words in, full cards out.
  await page.getByLabel('Слова для карточек').fill('luggage, check in');
  await button(page, 'Создать карточки · 2').click();
  const words = page.getByRole('list').filter({ hasText: 'luggage' });
  await expect(words.getByRole('listitem')).toHaveCount(2);
  await expect(words).toContainText('check in');
  await expect(words.getByRole('button', { name: 'Послушать: luggage' })).toBeVisible();

  // One more by hand, with the rest of the card suggested for review.
  await page.getByRole('tab', { name: 'Вручную' }).click();
  await page.getByLabel('Слово или выражение').fill('Passport');
  await button(page, 'Заполнить с ИИ').click();
  await expect(page.getByLabel('Перевод', { exact: true })).toHaveValue(/passport/);
  await page.getByLabel('Перевод', { exact: true }).fill('паспорт');
  await button(page, 'Добавить слово').click();
  await expect(words.getByRole('listitem')).toHaveCount(3);

  // Studied from the deck itself.
  await button(page, 'Учить · 3 слова').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('luggage');
  await finishSession(page);
  await button(page, 'На главную').click(); // back on the deck's page
  await expect(page.getByText(/3\s*из 3\sслова встречено/)).toBeVisible();
  await button(page, 'Мои колоды').click(); // home: the learner's own decks
  await expect(page.getByRole('button', { name: /^Путешествия/ })).toContainText('встречено 3');
});

test('a deck given to a group is in its members’ «Мои колоды»', async ({ page, context, browser }) => {
  const group = await (
    await context.request.post('/api/groups', { data: { name: '7Б английский', nickname: 'Ольга' } })
  ).json();
  const deck = await (await context.request.post('/api/decks', { data: { title: 'Unit 4' } })).json();
  await context.request.post(`/api/decks/${deck.id}/words`, {
    data: { headword: 'setback', pos: 'noun', translation: 'неудача', example: 'A setback.' },
  });
  await context.request.post(`/api/decks/${deck.id}/publish`, { data: { group_id: group.id } });

  const member = await browser.newContext({
    extraHTTPHeaders: { ...DEMO, 'X-Dev-User': `e2e-member-${Date.now().toString(36)}` },
  });
  await member.request.patch('/api/me', { data: { daily_target_words: 5, study_days_per_week: 6 } });
  await member.request.post(`/api/groups/join/${group.invite_code}`, { data: { nickname: 'Анна' } });
  const learner = await member.newPage();
  await learner.goto('/');
  await expect(learner.getByRole('region', { name: 'Из моих групп' })).toContainText('от Ольга · 7Б английский');
  await member.close();

  // The author finds it among her own, with the group it went to.
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Созданные мной' })).toContainText('в группе 7Б английский');
});

// A topic becomes cards (ADR 0019): the fourth way in the composer, demo provider here.
test('a topic gives a deck the words for it', async ({ page, context }) => {
  await context.request.post('/api/decks', { data: { title: 'Путешествия' } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Изменить «Путешествия»' }).click();
  await page.getByRole('tab', { name: 'Тема' }).click();
  await page.getByRole('textbox', { name: 'Тема' }).fill('в аэропорту');
  await page.getByRole('radio', { name: '5', exact: true }).check();
  await button(page, 'Составить карточки · 5').click();
  await expect(page.getByRole('status').filter({ hasText: 'Добавлено' })).toContainText('Добавлено: 5');
  await expect(page.getByRole('heading', { name: /Карточки в колоде/ })).toContainText('5');
});

// A deck keeps its topic (ADR 0019): offered again next time; a different topic is offered a
// deck of its own, or added here anyway.
test('a deck keeps its topic; a new topic is offered its own deck', async ({ page, context }) => {
  const deck = await (await context.request.post('/api/decks', { data: { title: 'Климат' } })).json();
  await context.request.post(`/api/decks/${deck.id}/words/topic`, { data: { topic: 'климат', count: 5 } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Изменить «Климат»' }).click();
  await page.getByRole('tab', { name: 'Тема' }).click();
  const topic = page.getByRole('textbox', { name: 'Тема' });
  await expect(topic).toHaveValue('климат'); // continuing is one tap

  // The same topic, written differently: no question asked.
  await topic.fill('Изменение климата');
  await expect(button(page, 'Составить карточки · 10')).toBeVisible();

  // A different one: a deck of its own is offered first.
  await topic.fill('технологии');
  await button(page, 'Составить карточки · 10').click();
  const fork = page.getByRole('group', { name: 'Это новая тема. Создать для неё отдельную колоду?' });
  await expect(fork).toContainText('Эта колода — о теме «климат»');
  await fork.getByRole('button', { name: 'Создать колоду «Технологии»' }).click();
  // The new deck opens with its cards; the climate deck is untouched.
  await expect(page.getByRole('textbox', { name: 'Название набора' })).toHaveValue('Технологии');
  await expect(page.getByRole('heading', { name: /Карточки в колоде/ })).toContainText('10');
  await button(page, 'Мои колоды').click();
  await expect(page.getByRole('button', { name: /^Климат/ })).toContainText('5 слов');
  await expect(page.getByRole('button', { name: /^Технологии/ })).toContainText('10 слов');

  // «Всё равно добавить сюда»: the words go into this deck.
  await page.getByRole('button', { name: 'Изменить «Климат»' }).click();
  await page.getByRole('tab', { name: 'Тема' }).click();
  await topic.fill('погода');
  await page.getByRole('radio', { name: '5', exact: true }).check();
  await button(page, 'Составить карточки · 5').click();
  await fork.getByRole('button', { name: 'Всё равно добавить сюда' }).click();
  await expect(page.getByRole('heading', { name: /Карточки в колоде/ })).toContainText('10');
});
