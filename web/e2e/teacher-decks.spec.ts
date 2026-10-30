import { type Page } from '@playwright/test';
import { button, DEMO, expect, finishSession, spellToday, test } from './learner.ts';

/** Makes a deck from home. */
async function newDeck(page: Page, title: string) {
  await page.getByRole('button', { name: /^Создать колоду/ }).click();
  await page.getByLabel('Название новой колоды').fill(title);
  await button(page, 'Создать').click();
  await expect(page.getByText('Моя колода')).toBeVisible();
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
    await context.request.post('/api/groups', { data: { name: '7Б английский', nickname: 'Ольга' } })
  ).json();
  const student = await browser.newContext({
    extraHTTPHeaders: {
      ...DEMO,
      'X-Dev-User': `e2e-student-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    },
  });
  await student.request.patch('/api/me', { data: { daily_target_words: 5, study_days_per_week: 6 } });
  await student.request.post(`/api/groups/join/${group.invite_code}`, { data: { nickname: 'Анна' } });

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
  await page.getByLabel('Перевод', { exact: true }).fill('проводить, выполнять');
  await button(page, 'Сохранить').click();
  await expect(words).toContainText('проводить, выполнять');

  await page.getByLabel('Дать группе').selectOption({ label: '7Б английский' });
  await button(page, 'Задать').click();
  await expect(page.getByRole('list', { name: 'Задано группам' })).toContainText('Задано группе «7Б английский»');
  await page.goto('/');
  await openGroup(page);
  // The board: no button to make decks there; each deck with the group's progress on it.
  await expect(page.getByRole('heading', { name: 'Колоды группы' })).toBeVisible();
  await expect(button(page, 'Дать слова группе')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Участники: «Unit 4»' })).toContainText('Анна0 из 2');

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
  await openGroup(page);
  await expect(page.getByRole('list', { name: 'Участники: «Unit 4»' })).toContainText('Анна2 из 2');
  await expect(page.getByText(/Группа: встречено 2 из 4 · все слова встретили 1 из 2/)).toBeVisible();
});

// Drafting from the lesson's text (ADR 0018), in demo mode (no model key in development).
test('a teacher drafts cards from a lesson text and reviews them', async ({ page }) => {
  // A laptop window: tall enough that the list's heading shows under the panel, its first card not.
  await page.setViewportSize({ width: 1280, height: 900 });
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
