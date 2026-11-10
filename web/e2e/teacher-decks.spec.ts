import { type Page } from '@playwright/test';
import { button, DEMO, expect, finishSession, spellToday, test, named } from './learner.ts';

/** Makes a deck from home. */
async function newDeck(page: Page, title: string) {
  await page.getByRole('button', { name: /^Создать колоду/ }).click();
  await page.getByLabel('Название новой колоды').fill(title);
  await button(page, 'Создать').click();
  await expect(page.getByRole('heading', { name: 'Новые карточки' })).toBeVisible();
}

/** «Друзья» always lists the groups first (ADR 0023); the group opens from its row. */
async function openGroup(page: Page) {
  await page
    .getByRole('button', { name: /Друзья/ })
    .first()
    .click();
  await page.getByRole('button', { name: /^7Б английский/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: '7Б английский' })).toBeVisible();
}

// A teacher's deck end to end (ADR 0017): the group's owner writes words and gives them to the
// group; a member meets them first in the daily lesson and spells the phrase; the owner sees it.
test('a teacher gives words to a group and a student learns them first', async ({ page, context, browser }) => {
  const group = await (
    await (await named(context, 'Ольга')).request.post('/api/groups', { data: { name: '7Б английский' } })
  ).json();
  const student = await browser.newContext({
    extraHTTPHeaders: {
      ...DEMO,
      'X-Dev-User': `e2e-student-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    },
  });
  await student.request.patch('/api/me', { data: { daily_target_words: 5, study_days_per_week: 6 } });
  await (await named(student, 'Анна')).request.post(`/api/groups/join/${group.invite_code}`);

  // The teacher writes a deck of her own in «Мои колоды», then gives it to her group.
  await page.goto('/');
  await newDeck(page, 'Unit 4');

  await page.getByRole('tab', { name: 'Вручную' }).click();
  await page.getByLabel('Слово или выражение').fill('Carry out');
  await page.getByLabel('Часть речи').selectOption('phrase');
  await page.getByLabel('Перевод', { exact: true }).fill('выполнять');
  await page.getByLabel('Пример', { exact: true }).fill('They carried out the experiment.');
  await button(page, 'Добавить слово').click();
  const words = page.getByRole('list').filter({ hasText: 'carry out' });
  await expect(words).toContainText('выполнять');
  // A course word is linked: its course meaning shows, marked as such.
  await page.getByLabel('Слово или выражение').fill('money');
  await page.getByLabel('Перевод', { exact: true }).fill('деньги');
  await page.getByLabel('Пример', { exact: true }).fill('No money.');
  await button(page, 'Добавить слово').click();
  await expect(words.getByRole('listitem').filter({ hasText: 'money' })).toContainText('из курса');

  // A correction before giving it.
  await words.getByRole('listitem').filter({ hasText: 'carry out' }).getByRole('button', { name: 'Изменить' }).click();
  // The form takes the word, then the cursor moves to its first field on the next frame: wait for
  // that, or typing can start in one field and land in another (seen on slow CI machines).
  await expect(page.getByLabel('Слово или выражение')).toHaveValue('carry out');
  await expect(page.getByLabel('Слово или выражение')).toBeFocused();
  await page.getByLabel('Перевод', { exact: true }).fill('проводить, выполнять');
  await button(page, 'Сохранить').click();
  await expect(words).toContainText('проводить, выполнять');

  // Giving the deck to the group: a button on the «Новые карточки» card opens a window, not a
  // section far down the page (ADR 0036).
  await expect(page.getByRole('heading', { name: 'Группы', exact: true })).toHaveCount(0);
  await button(page, 'Дать группе').click();
  const give = page.getByRole('dialog', { name: 'Дать группе' });
  // One list of my groups, with one thing to do on each (ADR 0049): nothing to fill in to give it.
  const giveTo = give.getByRole('button', { name: 'Дать группе «7Б английский»' });
  const takeBack = give.getByRole('button', { name: 'Отменить для группы «7Б английский»' });
  await giveTo.click();
  await expect(takeBack).toBeVisible();
  await expect(give.getByText('Указать срок')).toBeVisible();
  // Undone from the same place, and given again: the deadline comes back with it.
  const due = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  await give.getByLabel('Срок для группы «7Б английский»').fill(due);
  await expect(give.getByText(/^К \d+ /)).toBeVisible();
  await takeBack.click();
  await expect(give.getByText(/^К \d+ /)).toHaveCount(0);
  await giveTo.click();
  await expect(takeBack).toBeVisible();
  await expect(give.getByText(/^К \d+ /)).toBeVisible();
  await page.keyboard.press('Escape');
  // The button now says where it is.
  await expect(button(page, 'В группе «7Б английский»')).toBeVisible();
  await page.goto('/');
  await openGroup(page);
  // The group's decks are folded under «Управление группой», with «Изменить» for the author.
  await expect(button(page, 'Дать слова группе')).toHaveCount(0);
  await page.getByText('Управление группой').click();
  await expect(page.getByRole('heading', { name: 'Колоды группы' })).toBeVisible();
  await expect(page.locator('details').getByRole('listitem').filter({ hasText: 'Unit 4' })).toContainText(
    '2\u00a0слова',
  );

  // The student finds it in «Мои колоды» and studies it from its page, within their own pace.
  const learner = await student.newPage();
  await learner.goto('/');
  await expect(learner.getByRole('region', { name: 'Из моих групп' })).toContainText('от Ольга · 7Б английский');
  await learner.getByRole('button', { name: /^Unit 4/ }).click();
  await expect(learner.getByText('от Ольга · 7Б английский')).toBeVisible();
  await button(learner, 'Начать урок · 2 слова').click();
  await expect(learner.getByRole('heading', { level: 1 })).toHaveText('carry out');
  await finishSession(learner);
  await button(learner, 'На главную').click();
  // The phrase is built from letters; its space is a fixed gap.
  await spellToday(learner);
  await student.close();

  // The teacher finds it among her own decks, given to the group.
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Созданные мной' })).toContainText('в группе 7Б английский');
  // The student finished a lesson today: named among those who kept the promise, with the deck as
  // on «Прогресс»: words met, though none is recalled in a later review yet (ADR 0052).
  await openGroup(page);
  const kept = page.getByRole('region', { name: 'Сделали сегодня' });
  await expect(page.getByText('Слова из «Unit 4»')).toBeVisible();
  const anna = kept.getByRole('button', { name: /^Анна/ });
  await expect(anna.getByRole('img', { name: 'учу 2' })).toBeVisible();
  await expect(anna).toContainText('2\u00a0/\u00a02');
});

// Drafting from the lesson's text (ADR 0018), in demo mode (no model key in development).
test('a teacher drafts cards from a lesson text and reviews them', async ({ page }) => {
  // A laptop window: tall enough that the list's heading shows under the panel, its first card not.
  await page.setViewportSize({ width: 1280, height: 900 });
  // A slow phone: the screen must move to the new cards once they are drawn, not to where they will be.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 12 });
  await page.goto('/');
  await newDeck(page, 'Unit 4');
  await page.getByRole('tab', { name: 'Текст' }).click();
  await page
    .getByLabel('Текст урока')
    .fill('After several setbacks, the company managed to carry out the experiment in the laboratory.');
  await page.getByRole('radio', { name: '5', exact: true }).check();
  await button(page, 'Подобрать 5\u00a0слов').click();

  await expect(page.getByRole('status').filter({ hasText: 'Добавлено' })).toContainText('Добавлено: 5');
  const words = page.getByRole('list').filter({ hasText: 'setbacks' });
  await expect(words.getByRole('listitem')).toHaveCount(5);
  // The screen moves down to the new cards: the first one shows whole.
  await expect(words.getByRole('listitem').first()).toBeInViewport({ ratio: 1 });
  // Each card shows the sentence it came from; the demo says its translations are not real.
  await expect(page.getByText('Демо-режим')).toBeVisible();
  // A review fix before giving the deck: the manual form opens for the word.
  await words.getByRole('listitem').first().getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Перевод', { exact: true }).fill('несколько');
  await button(page, 'Сохранить').click();
  await expect(words.getByRole('listitem').first()).toContainText('несколько');
  await expect(button(page, 'Учить · 5\u00a0слов')).toBeEnabled();
});
