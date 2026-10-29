import { answer, button, expect, test } from './learner.ts';

test('a learner creates a group, a friend joins by link, both are on the board', async ({ page, browser }) => {
  await page.goto('/');
  await button(page, 'Начать урок · 5 слов').click();
  for (let step = 0; step < 15; step += 1) await answer(page);
  await button(page, 'На главную').click();

  await page.getByRole('button', { name: /Учитесь с друзьями/ }).click();
  await expect(page.getByRole('heading', { name: 'Друзья' })).toBeFocused();
  await page.getByLabel('Название').fill('7Б английский');
  await page.getByLabel('Или своё').fill('Ёжик');
  await button(page, 'Создать и пригласить').click();

  await expect(page.getByRole('heading', { name: '7Б английский' })).toBeFocused();
  await expect(page.getByRole('img', { name: /QR-код/ })).toBeVisible();
  const link = await page.getByLabel('Ссылка-приглашение').inputValue();
  expect(link).toMatch(/\/join\/[A-Z2-9]{8}$/);
  const me = page.getByRole('listitem').filter({ hasText: 'Ёжик' });
  await expect(me).toContainText('вы');
  await expect(me).toContainText('1 день');
  await expect(me).toContainText('50 очков');

  // A friend (a different learner) opens the link.
  const friendContext = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': `e2e-friend-${Date.now()}` } });
  await friendContext.request.patch('/api/me', { data: { daily_target_words: 3 } });
  const friend = await friendContext.newPage();
  await friend.goto(new URL(link).pathname);
  await expect(friend.getByRole('heading', { name: '7Б английский' })).toBeFocused();
  await expect(friend.getByText('1 участник')).toBeVisible();
  await expect(friend).toHaveURL(/\/$/);
  await friend.getByLabel('Или своё').fill('ёжик');
  await friend.getByRole('button', { name: 'Вступить', exact: true }).click();
  await expect(friend.getByRole('alert')).toHaveText('Это имя уже занято в группе — выберите другое.');
  await friend.getByLabel('Или своё').fill('Лис');
  await friend.getByRole('button', { name: 'Вступить', exact: true }).click();

  await expect(friend.getByRole('heading', { name: '7Б английский' })).toBeFocused();
  await expect(friend.getByText('Ещё не начали на этой неделе')).toBeVisible();
  await expect(friend.getByRole('listitem').filter({ hasText: 'Лис' })).toContainText('вы');
  await friendContext.close();

  // Back on home, the friends card shows the place.
  await button(page, 'Назад').click();
  await expect(page.getByRole('button', { name: /7Б английский/ })).toContainText('вы на 1-м месте из 2');
});
