import { button, expect, finishSession, test } from './learner.ts';

test('a learner creates a group, a friend joins by link, both are on the board', async ({ page, browser }) => {
  await page.goto('/');
  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
  await button(page, 'На главную').click();

  await button(page, 'Друзья').click();
  await expect(page.getByRole('heading', { name: 'Друзья' })).toBeFocused();
  await page.getByLabel('Название').fill('7Б английский');
  await page.getByLabel('Или своё').fill('Ёжик');
  await button(page, 'Создать и пригласить').click();

  await expect(page.getByRole('heading', { name: '7Б английский' })).toBeVisible();
  // A new group opens its invitation straight away, in a window over the board (focus is in it).
  const invitation = page.getByRole('dialog', { name: 'Пригласить друзей' });
  await expect(invitation.getByRole('img', { name: /QR-код/ })).toBeVisible();
  const link = await invitation.getByLabel('Ссылка-приглашение').inputValue();
  expect(link).toMatch(/\/join\/[A-Z2-9]{8}$/);
  // Closing it leaves the board, and the button on the board brings it back.
  await invitation.getByRole('button', { name: 'Закрыть' }).click();
  await expect(invitation).toHaveCount(0);
  await expect(page.getByRole('img', { name: /QR-код/ })).toHaveCount(0);
  await button(page, 'Пригласить друзей').click();
  await expect(invitation.getByRole('img', { name: /QR-код/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(invitation).toHaveCount(0);
  await expect(button(page, 'Пригласить друзей')).toBeFocused();
  const me = page.getByRole('listitem').filter({ hasText: 'Ёжик' });
  await expect(me).toContainText('вы');
  // One day of the six promised, measured against her own plan; no points anywhere.
  await expect(me).toContainText('1 из 6 дней');
  await expect(page.getByRole('main')).not.toContainText('очк');

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

  // With a single group, «Друзья» opens its board; the place is on the board, not in the navigation.
  await button(page, 'Сегодня').click();
  await button(page, 'Друзья').click();
  await expect(page.getByRole('heading', { name: '7Б английский' })).toBeFocused();
  await expect(button(page, 'Друзья')).toHaveAccessibleDescription('');
});
