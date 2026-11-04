import { button, expect, finishSession, openDeck, test } from './learner.ts';

// A Monday: the server clock is fixed so "today" is a promised day (Пн–Сб by default).
const MONDAY = '2026-11-02T09:00:00Z';

test('a learner creates a group, a friend joins by link, both are in the report', async ({
  page,
  browser,
  learner,
}) => {
  await learner.travelTo(new Date(MONDAY));
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

  // A promise and a report (ADR 0039): who did today's promise as plain lists of names. No places,
  // points or ranking.
  await expect(page.getByRole('heading', { name: 'Сегодня по обещанию' })).toBeVisible();
  await expect(page.getByText('Вы: сделано')).toBeVisible();
  await expect(page.getByText(/Моё обещание: Пн–Сб/)).toBeVisible();
  const done = page.getByRole('region', { name: 'Сделали сегодня' });
  const me = done.getByRole('button', { name: /^Ёжик.*пропусков: 0/ });
  await expect(me).toBeVisible();
  await expect(page.getByRole('region', { name: 'Не сделали' })).toHaveCount(0);
  await expect(page.getByRole('main')).not.toContainText(/мест[оае]|очк|рейтинг|карточ/i);
  for (const gone of ['Всё время', 'Месяц']) await expect(button(page, gone)).toHaveCount(0);
  // The rule is one tap away; a person's window shows their words apart from the promise.
  await button(page, 'Как это считается?').click();
  await expect(page.getByRole('dialog', { name: 'Как это считается' })).toContainText('первого числа каждого месяца');
  await page.keyboard.press('Escape');
  await me.click();
  const window = page.getByRole('dialog', { name: 'Ёжик (вы)' });
  await expect(window).toContainText('Пропущено дней в этом месяце: 0');
  // The week of dots, under its label, says the promise; no weeks-in-a-row figure.
  await expect(window.getByRole('region', { name: 'Обещанные дни' })).toBeVisible();
  await expect(window).not.toContainText(/недел/i);
  await expect(window).toContainText('знаю 0 · учу 5');
  await page.keyboard.press('Escape');

  // A friend (a different learner) opens the link.
  const friendContext = await browser.newContext({
    extraHTTPHeaders: { 'X-Dev-User': `e2e-friend-${Date.now()}`, 'X-Dev-Now': MONDAY },
  });
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
  await expect(friend.getByText('Вы: ещё нет')).toBeVisible();
  await expect(friend.getByRole('region', { name: 'Сделали сегодня' })).toContainText('Ёжик');
  await expect(friend.getByRole('region', { name: 'Не сделали' }).getByRole('button', { name: /^Лис/ })).toBeVisible();
  await friendContext.close();

  // «Друзья» always opens the list, even with one group: each group with its pulse.
  await button(page, 'Сегодня').click();
  await button(page, 'Друзья').click();
  await expect(page.getByRole('heading', { name: 'Друзья' })).toBeFocused();
  // One line a group: today by the promise, and me.
  const row = page.getByRole('button', { name: /^7Б английский/ });
  await expect(row).toContainText('сегодня по обещанию 1 из 2 · вы ✓');
  await row.click();
  await expect(
    page.getByRole('region', { name: 'Не сделали' }).getByRole('button', { name: /^Лис.*пропусков: 0/ }),
  ).toBeVisible();
  // Leaving is a quiet link at the bottom for everyone (ADR 0040), not folded away; the group's own
  // management is.
  await expect(button(page, 'Выйти из группы')).toBeVisible();
  await expect(button(page, 'Удалить группу')).toBeHidden();
  await page.getByText('Управление группой').click();
  await expect(button(page, 'Удалить группу')).toBeVisible();
});
