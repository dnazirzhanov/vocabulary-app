import { button, DEMO, expect, openDeck, test, named } from './learner.ts';

// Friends study a course level together (ADR 0065): the group's owner gives it from its page like
// a deck of their own; a friend on an earlier level finds it open and starts at once.

test('a course level is given to a group and a friend studies it from an earlier level', async ({
  page,
  context,
  browser,
}) => {
  const group = await (
    await (await named(context, 'Ольга')).request.post('/api/groups', { data: { name: 'Друзья' } })
  ).json();
  const friend = await browser.newContext({
    extraHTTPHeaders: { ...DEMO, 'X-Dev-User': `e2e-friend-${Date.now().toString(36)}` },
  });
  await friend.request.patch('/api/me', { data: { daily_target_words: 5, study_days_per_week: 6 } });
  await (await named(friend, 'Анна')).request.post(`/api/groups/join/${group.invite_code}`);

  await page.goto('/');
  await openDeck(page, 'Уверенный уровень');
  await button(page, 'Дать группе').click();
  const give = page.getByRole('dialog', { name: 'Дать группе' });
  await give.getByRole('button', { name: 'Дать группе «Друзья»' }).click();
  await page.keyboard.press('Escape');
  await expect(button(page, 'В группе «Друзья»')).toBeVisible();

  // The friend hasn't finished «Основа», yet the given level opens and offers a lesson.
  const learner = await friend.newPage();
  await learner.goto('/');
  await openDeck(learner, 'Уверенный уровень');
  await expect(learner.getByRole('button', { name: /^Начать урок · \d+/ })).toBeEnabled();
  await friend.close();
});
