import { type Page } from '@playwright/test';
import { button, expect, test } from './learner.ts';

// A card's «⋯» in a lesson: the example's speed, and «Сообщить об ошибке» (sent with the other
// changes, so it works offline). The word list reports too. A deck's own card's reports reach
// its author, in the editor; «Исправлено» closes them.

const home = (page: Page) => page.getByRole('heading', { level: 1, name: 'Мои колоды' });

test('a card reported offline from a lesson and one from the word list reach the deck’s author', async ({
  page,
  context,
}) => {
  const deck = await (await page.request.post('/api/decks', { data: { title: 'Поездка' } })).json();
  for (const [headword, translation] of [
    ['ticket', 'ложка'],
    ['hotel', 'гостиница'],
  ]) {
    await page.request.post(`/api/decks/${deck.id}/words`, {
      data: { headword, pos: 'noun', translation, example: `A ${headword} here.` },
    });
  }
  await page.goto('/');
  await expect(home(page)).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: /^Поездка/ }).click();
  await button(page, 'Начать урок · 2 слова').click();
  await page.locator('[data-card]').waitFor();

  // Offline: the card's «⋯» — slower examples, and the wrong translation said.
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Ещё о карточке' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Медленная' }).click();
  await expect(sheet.getByRole('button', { name: 'Медленная' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('example-speed'))).toBe('slow');
  const word = (await sheet.getByRole('heading').first().textContent())!;
  await sheet.getByRole('radio', { name: 'Неверный перевод' }).click();
  await sheet.getByLabel('Что не так (необязательно)').fill('не ложка');
  await sheet.getByRole('button', { name: 'Отправить' }).click();
  await expect(sheet.getByRole('status')).toHaveText('Спасибо! Мы проверим карточку.');
  // Typing in the sheet never rated the card behind it.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Показать ответ' })).toBeVisible();

  // Online again: it is sent; the word list reports the other card.
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Выйти из урока' }).click();
  await page.goto('/');
  await page.getByRole('button', { name: /^Поездка/ }).click();
  await page.getByRole('button', { name: /^Все слова колоды/ }).click();
  const other = word === 'ticket' ? 'hotel' : 'ticket';
  await page.getByRole('button', { name: `Сообщить об ошибке в «${other}»` }).click();
  const listSheet = page.getByRole('dialog');
  await expect(listSheet.getByRole('button', { name: 'Медленная' })).toHaveCount(0);
  await listSheet.getByRole('radio', { name: 'Неверный пример' }).click();
  await listSheet.getByRole('button', { name: 'Отправить' }).click();
  await expect(listSheet.getByRole('status')).toBeVisible();

  // The author (me): both cards in the editor's list; «Исправлено» closes one.
  await expect
    .poll(async () => (await (await page.request.get(`/api/decks/${deck.id}/card-reports`)).json()).cards.length)
    .toBe(2);
  await page.goto('/');
  await page.getByRole('button', { name: 'Изменить «Поездка»' }).click();
  await page.getByRole('button', { name: 'Ошибки в карточках · 2' }).click();
  const reports = page.getByRole('dialog', { name: 'Ошибки в карточках' });
  await expect(reports.getByRole('listitem').filter({ hasText: word })).toContainText('не ложка');
  await reports.getByRole('listitem').filter({ hasText: word }).getByRole('button', { name: 'Исправлено' }).click();
  await expect(reports.getByRole('listitem')).toHaveCount(1);
});
