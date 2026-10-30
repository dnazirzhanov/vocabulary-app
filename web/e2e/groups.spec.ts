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

  // Only what to act on (ADR 0032): my week in one line, then the week's league — one number a
  // person and ✓ for who studied today. No period switch, no rule paragraph, no totals.
  await expect(page.getByText('Вы на 1-м месте')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Неделя' })).toBeVisible();
  const me = page.getByRole('button', { name: /^1-е место: Ёжик \(вы\)/ });
  await expect(me).toContainText('0\u00a0слов');
  await expect(me).toHaveAccessibleName(/сегодня уже есть занятие/);
  for (const gone of ['Всё время', 'Месяц']) await expect(button(page, gone)).toHaveCount(0);
  await expect(page.getByText(/^Вместе за/)).toHaveCount(0);
  await expect(page.getByText(/^Место — по выученным словам/)).toHaveCount(0);
  await expect(page.getByRole('main')).not.toContainText(/план|(?<!карт)очк|карточ/i); // no plan, points, cards
  // The rule is one tap away; a person's figures open from their row.
  await button(page, 'Как считаются места?').click();
  await expect(page.getByRole('dialog', { name: 'Как считаются места' })).toContainText('по выученным словам');
  await page.keyboard.press('Escape');
  await me.click();
  const window = page.getByRole('dialog', { name: 'Ёжик (вы)' });
  await expect(window).toContainText('дней занятий на этой неделе1');
  await expect(window).toContainText(/карточек на этой неделе\d+/);
  await expect(window).toContainText('выучено за всё время0\u00a0слов');
  await page.keyboard.press('Escape');

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
  await expect(friend.getByText('Ещё не начинали: Лис (вы)')).toBeVisible();
  await friendContext.close();

  // «Друзья» always opens the list, even with one group: each group with its pulse.
  await button(page, 'Сегодня').click();
  await button(page, 'Друзья').click();
  await expect(page.getByRole('heading', { name: 'Друзья' })).toBeFocused();
  // One line a group: my place and how many studied today.
  const row = page.getByRole('button', { name: /^7Б английский/ });
  await expect(row).toContainText('вы на 1-м месте · сегодня занимались 1 из 2');
  await row.click();
  await expect(page.getByText('Ещё не начинали: Лис')).toBeVisible();
  // Housekeeping is folded away at the bottom.
  await expect(button(page, 'Выйти из группы')).toBeHidden();
  await page.getByText('Управление группой').click();
  await expect(button(page, 'Выйти из группы')).toBeVisible();
});
