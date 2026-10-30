import { button, expect, finishSession, openDeck, test } from './learner.ts';

test('a learner creates a group, a friend joins by link, both are on the board', async ({ page, browser }) => {
  await page.goto('/');
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
  await button(page, 'На главную').click();

  // «Друзья» lists the groups first; creating one is a window, not a form on the page.
  await button(page, 'Друзья').click();
  await expect(page.getByRole('heading', { name: 'Друзья' })).toBeFocused();
  await page.getByRole('button', { name: 'Создать группу' }).click();
  const creating = page.getByRole('dialog', { name: 'Новая группа' });
  await creating.getByLabel('Название').fill('7Б английский');
  await creating.getByLabel('Или своё').fill('Ёжик');
  await creating.getByRole('button', { name: 'Создать и пригласить' }).click();

  await expect(page.getByRole('heading', { name: '7Б английский' })).toBeVisible();
  // A new group opens its invitation straight away, in a window over the group (focus is in it).
  const invitation = page.getByRole('dialog', { name: 'Пригласить друзей' });
  await expect(invitation.getByRole('img', { name: /QR-код/ })).toBeVisible();
  const link = await invitation.getByLabel('Ссылка-приглашение').inputValue();
  expect(link).toMatch(/\/join\/[A-Z2-9]{8}$/);
  await invitation.getByRole('button', { name: 'Закрыть' }).click();
  await expect(invitation).toHaveCount(0);
  await button(page, 'Пригласить').click();
  await expect(invitation.getByRole('img', { name: /QR-код/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(button(page, 'Пригласить')).toBeFocused();

  // Today, my place and the board: one day studied this week, no word learned yet (that takes a
  // review on a later day). One ranking, said in one line: no tabs, no «план».
  await expect(page.getByRole('heading', { name: /Сегодня занимались 1 из 1/ })).toBeVisible();
  await expect(page.getByText('Вы на 1-м месте')).toBeVisible();
  await expect(page.getByText(/^Место — по выученным словам/)).toBeVisible();
  const me = page.getByRole('listitem').filter({ hasText: 'Ёжик' }).filter({ hasText: 'занятий' });
  await expect(me).toContainText('0\u00a0слов');
  await expect(me).toContainText('1\u00a0день занятий');
  await expect(me).toContainText(/\d+\u00a0карточ/);
  await expect(page.getByRole('main')).not.toContainText(/план|(?<!карт)очк/i); // no plan, no points
  await expect(page.getByRole('button', { name: 'Регулярность' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Всё время' }).click();
  await expect(page.getByRole('heading', { name: 'Вместе за всё время' })).toBeVisible();
  await page.getByRole('button', { name: 'Неделя' }).click();

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
  await expect(friend.getByText('Вы ещё не занимались на этой неделе')).toBeVisible();
  await expect(friend.locator('p', { hasText: 'Ещё не занимались на этой неделе:' })).toContainText('Лис (вы)');
  await friendContext.close();

  // «Друзья» always opens the list, even with one group: each group with its pulse.
  await button(page, 'Сегодня').click();
  await button(page, 'Друзья').click();
  await expect(page.getByRole('heading', { name: 'Друзья' })).toBeFocused();
  const row = page.getByRole('button', { name: /^7Б английский/ });
  await expect(row).toContainText('вы на 1-м месте на неделе');
  await expect(row).toContainText('сегодня занимались 1 из 2');

  // Members are statistics on the board; nothing opens on a tap, and there is no «Профиль».
  await row.click();
  await expect(page.locator('p', { hasText: 'Ещё не занимались на этой неделе:' })).toContainText('Лис');
  await expect(page.getByRole('button', { name: /^Лис/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Профиль' })).toHaveCount(0);
});
