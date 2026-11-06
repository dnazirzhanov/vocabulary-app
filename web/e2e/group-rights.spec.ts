import { type Browser, type BrowserContext, type Page } from '@playwright/test';
import { button, DEMO, expect, test } from './learner.ts';

// What each person may do in a group (ADR 0040): the owner renames it, hands it over, removes
// people, makes a new link and deletes it; everyone can leave, and an owner names who takes over.

async function member(browser: Browser, code: string, nickname: string, id: string) {
  const context = await browser.newContext({
    extraHTTPHeaders: { ...DEMO, 'X-Dev-User': `e2e-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` },
  });
  await context.request.patch('/api/me', { data: { daily_target_words: 5, study_days_per_week: 6 } });
  await context.request.post(`/api/groups/join/${code}`, { data: { nickname } });
  return context;
}

async function ownerGroup(context: BrowserContext, name = '7Б английский') {
  const group = await (await context.request.post('/api/groups', { data: { name, nickname: 'Ольга' } })).json();
  return group as { id: string; invite_code: string };
}

async function openGroup(page: Page, name = '7Б английский') {
  await page.goto('/');
  await page
    .getByRole('button', { name: /Друзья/ })
    .first()
    .click();
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

test('the owner renames the group in place and members cannot', async ({ page, context, browser }) => {
  const group = await ownerGroup(context);
  const anna = await member(browser, group.invite_code, 'Анна', 'anna');
  await openGroup(page);

  await button(page, 'Переименовать группу').click();
  await page.getByLabel('Название группы').fill('  8А   английский ');
  await button(page, 'Сохранить').click();
  await expect(page.getByRole('heading', { level: 1, name: '8А английский' })).toBeFocused();

  // The new name is everyone's; the pencil is only for those who may rename.
  const friend = await anna.newPage();
  await openGroup(friend, '8А английский');
  await expect(button(friend, 'Переименовать группу')).toHaveCount(0);
  await expect(button(friend, 'Пригласить')).toBeVisible();
  await friend.close();

  // A bad name is refused with a reason, and nothing changes.
  await button(page, 'Переименовать группу').click();
  await page.getByLabel('Название группы').fill('https://spam.example');
  await button(page, 'Сохранить').click();
  await expect(page.getByRole('alert')).toHaveText('Название: от 2 до 40 символов, без ссылок.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { level: 1, name: '8А английский' })).toBeVisible();
});

test('a member leaves from the bottom of the page', async ({ page, browser, context }) => {
  const group = await ownerGroup(context);
  const anna = await member(browser, group.invite_code, 'Анна', 'anna');
  const friend = await anna.newPage();
  await openGroup(friend);

  // No fold to open: leaving is always there, and asks once.
  await expect(button(friend, 'Управление группой')).toHaveCount(0);
  await button(friend, 'Выйти из группы').click();
  await friend.getByRole('button', { name: 'Да, выйти' }).click();
  await expect(friend.getByRole('heading', { name: 'Друзья' })).toBeFocused();
  await expect(friend.getByRole('button', { name: /^7Б английский/ })).toHaveCount(0);

  // The group goes on without her.
  await openGroup(page);
  await expect(page.getByRole('button', { name: /^Анна/ })).toHaveCount(0);
});

test('an owner who leaves names who takes the group over', async ({ page, browser, context }) => {
  const group = await ownerGroup(context);
  const anna = await member(browser, group.invite_code, 'Анна', 'anna');
  const boris = await member(browser, group.invite_code, 'Борис', 'boris');
  await openGroup(page);

  await button(page, 'Выйти из группы').click();
  const handOver = page.getByRole('dialog', { name: 'Кому передать группу?' });
  await expect(handOver.getByRole('button', { name: 'Передать и выйти' })).toBeDisabled();
  await handOver.getByLabel('Борис').check();
  await handOver.getByRole('button', { name: 'Передать и выйти' }).click();
  await expect(page.getByRole('heading', { name: 'Друзья' })).toBeFocused();

  // Борис owns it now; Анна is still an ordinary member; Ольга is no longer in the group.
  expect((await (await boris.request.get('/api/groups')).json())[0].can).toContain('rename');
  expect((await (await anna.request.get('/api/groups')).json())[0].can).toEqual([]);
  expect(await (await context.request.get('/api/groups')).json()).toEqual([]);
});

test('the owner hands the group over, or removes someone, from that person’s window', async ({
  page,
  browser,
  context,
}) => {
  const group = await ownerGroup(context);
  await member(browser, group.invite_code, 'Анна', 'anna');
  await member(browser, group.invite_code, 'Борис', 'boris');
  await openGroup(page);

  // Removing asks once, and the person is gone.
  await page.getByRole('button', { name: /^Борис/ }).click();
  const window = page.getByRole('dialog', { name: 'Борис' });
  await window.getByRole('button', { name: 'Удалить из группы' }).click();
  await expect(window).toContainText('Удалить «Борис» из группы?');
  await window.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(page.getByRole('button', { name: /^Борис/ })).toHaveCount(0);

  // Handing over: the owner becomes an ordinary member and loses the owner's controls.
  await page.getByRole('button', { name: /^Анна/ }).click();
  await page.getByRole('dialog', { name: 'Анна' }).getByRole('button', { name: 'Сделать владельцем' }).click();
  await page.getByRole('button', { name: 'Да, передать' }).click();
  await expect(button(page, 'Переименовать группу')).toHaveCount(0);
  await expect(button(page, 'Управление группой')).toHaveCount(0);
  // Nobody manages themselves: no «Управление» in their own window.
  await page.getByRole('button', { name: /^Ольга/ }).click();
  await expect(
    page.getByRole('dialog', { name: 'Ольга (вы)' }).getByRole('heading', { name: 'Управление' }),
  ).toHaveCount(0);
});

test('a new invite link stops the old one, and the owner can delete the group', async ({ page, browser, context }) => {
  const group = await ownerGroup(context);
  const anna = await member(browser, group.invite_code, 'Анна', 'anna');
  await openGroup(page);

  await button(page, 'Пригласить').click();
  const invitation = page.getByRole('dialog', { name: 'Пригласить друзей' });
  const before = await invitation.getByLabel('Ссылка-приглашение').inputValue();
  await invitation.getByRole('button', { name: 'Новая ссылка' }).click();
  await expect(invitation).toContainText('Старая ссылка и QR-код перестанут работать');
  await invitation.getByRole('button', { name: 'Да, создать' }).click();
  await expect(invitation.getByLabel('Ссылка-приглашение')).not.toHaveValue(before);
  expect((await context.request.get(`/api/groups/join/${group.invite_code}`)).status()).toBe(404);
  await page.keyboard.press('Escape');

  // A member sees the link but cannot replace it.
  const friend = await anna.newPage();
  await openGroup(friend);
  await button(friend, 'Пригласить').click();
  await expect(friend.getByRole('dialog', { name: 'Пригласить друзей' })).toBeVisible();
  await expect(button(friend, 'Новая ссылка')).toHaveCount(0);
  await friend.keyboard.press('Escape');

  // Deleting says what goes and what stays, and asks once.
  await page.getByText('Управление группой').click();
  await button(page, 'Удалить группу').click();
  await expect(page.getByText(/Колоды останутся у своих авторов/)).toBeVisible();
  await page.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(page.getByRole('heading', { name: 'Друзья' })).toBeFocused();
  expect(await (await anna.request.get('/api/groups')).json()).toEqual([]);
});

test('the owner removes a deck from the group page, after being asked, and a member cannot', async ({
  page,
  context,
  browser,
}) => {
  const group = await ownerGroup(context);
  const deck = await (await context.request.post('/api/decks', { data: { title: 'Unit 4' } })).json();
  await context.request.post(`/api/decks/${deck.id}/words`, {
    data: { headword: 'setback', pos: 'noun', translation: 'неудача', example: 'A setback.' },
  });
  await context.request.post(`/api/decks/${deck.id}/publish`, { data: { group_id: group.id } });
  const anna = await member(browser, group.invite_code, 'Анна', 'anna');
  const annaPage = await anna.newPage();
  await openGroup(annaPage);
  await annaPage.getByText('Управление группой').click();
  await expect(annaPage.getByRole('button', { name: /^Убрать/ })).toHaveCount(0);

  await openGroup(page);
  await page.getByText('Управление группой').click();
  await page.getByRole('button', { name: 'Убрать «Unit 4» из группы' }).click();
  const asked = page.getByRole('dialog', { name: 'Убрать «Unit 4»?' });
  await expect(asked.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await asked.getByRole('button', { name: 'Отмена' }).click();
  await expect(page.getByRole('button', { name: 'Убрать «Unit 4» из группы' })).toBeVisible();

  await page.getByRole('button', { name: 'Убрать «Unit 4» из группы' }).click();
  await asked.getByRole('button', { name: 'Убрать из группы' }).click();
  await expect(asked).toHaveCount(0);
  await expect(page.getByText('Колоды группы')).toHaveCount(0);

  await annaPage.reload();
  const library = await (await anna.request.get('/api/decks/library')).json();
  expect(library.from_groups).toEqual([]);
  await anna.close();
});
