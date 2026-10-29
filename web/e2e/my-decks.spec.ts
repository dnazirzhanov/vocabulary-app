import { button, DEMO, expect, finishSession, test } from './learner.ts';

// «Мои колоды» (ADR 0019): a deck of one's own from «Сегодня», cards made from words with AI
// (demo provider here), studied by opening the deck.
test('a learner makes a deck from words and studies it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Мои колоды/ }).click();
  await expect(page.getByRole('heading', { name: 'Мои колоды' })).toBeFocused();
  await page.getByRole('button', { name: 'Новая колода' }).click();
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
  await page.getByText('Добавить слово вручную').click();
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
  await button(page, 'На главную').click();
  await page.getByRole('button', { name: /^Мои колоды · 1/ }).click();
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
  await learner.getByRole('button', { name: /^Мои колоды/ }).click();
  await expect(learner.getByRole('region', { name: 'Из моих групп' })).toContainText('от Ольга · 7Б английский');
  await member.close();

  // The author finds it among her own, with the group it went to.
  await page.goto('/');
  await page.getByRole('button', { name: /^Мои колоды/ }).click();
  await expect(page.getByRole('region', { name: 'Созданные мной' })).toContainText('в группе 7Б английский');
});
