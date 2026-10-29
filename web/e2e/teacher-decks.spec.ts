import { type Page } from '@playwright/test';
import { button, expect, finishSession, spellToday, test } from './learner.ts';

/** «Друзья» opens the board straight away once it knows the group, the list of groups before. */
async function openGroup(page: Page) {
  await page
    .getByRole('button', { name: /Друзья/ })
    .first()
    .click();
  const listed = page.getByRole('button', { name: /^7Б английский/ });
  const board = page.getByRole('heading', { level: 1, name: '7Б английский' });
  await expect(listed.or(board)).toBeVisible();
  if (await listed.isVisible()) await listed.click();
  await expect(board).toBeVisible();
}

// A teacher's deck end to end (ADR 0017): the group's owner writes words and gives them to the
// group; a member meets them first in the daily lesson and spells the phrase; the owner sees it.
test('a teacher gives words to a group and a student learns them first', async ({ page, context, browser }) => {
  const group = await (
    await context.request.post('/api/groups', { data: { name: '7Б английский', nickname: 'Ольга' } })
  ).json();
  const student = await browser.newContext({
    extraHTTPHeaders: {
      'X-Dev-User': `e2e-student-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    },
  });
  await student.request.patch('/api/me', { data: { daily_target_words: 5, study_days_per_week: 6 } });
  await student.request.post(`/api/groups/join/${group.invite_code}`, { data: { nickname: 'Анна' } });

  // The teacher writes the deck from the group's board.
  await page.goto('/');
  await openGroup(page);
  await button(page, 'Дать слова группе').click();
  const title = page.getByLabel('Название набора');
  await title.fill('Unit 4');
  await title.press('Enter');

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

  await button(page, 'Задать группе · 2 слова').click();
  await expect(page.getByRole('status')).toContainText('Задано группе «7Б английский»');
  await button(page, 'Готово').click();
  await expect(page.getByRole('heading', { name: 'Слова для группы' })).toBeVisible();
  await expect(page.getByRole('list', { name: /Кто сколько слов встретил/ })).toContainText('Анна0 из 2');

  // The student meets the teacher's words first, within their own five a day.
  const learner = await student.newPage();
  await learner.goto('/');
  await expect(learner.getByRole('button', { name: /^Unit 4/ })).toHaveAccessibleName(
    /от группы «7Б английский» · 0 из 2 2 новых/,
  );
  await button(learner, 'Начать урок · 5 слов').click();
  await expect(learner.getByRole('heading', { level: 1 })).toHaveText('carry out');
  await finishSession(learner);
  await button(learner, 'На главную').click();
  // The phrase is built from letters; its space is a fixed gap.
  await spellToday(learner);
  await student.close();

  await page.reload();
  await openGroup(page);
  await expect(page.getByRole('list', { name: /Кто сколько слов встретил/ })).toContainText('Анна2 из 2');
});
