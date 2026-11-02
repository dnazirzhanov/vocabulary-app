import { type Page } from '@playwright/test';
import { button, expect, finishSession, openDeck, test } from './learner.ts';

const DAY = 86_400_000;

/** Today on a deck's page: one sentence (ADR 0035). */
const today = (page: Page) => page.getByRole('region', { name: 'Сегодня в колоде' }).locator('p').first();
const deckRow = (page: Page, title: string) => page.getByRole('button', { name: new RegExp(`^${title}`) });

test('the course lists the levels; a deck’s page counts today like Anki and studies that deck', async ({
  page,
  learner,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeFocused();
  // Home is the learner's own decks; the course is one tap away (ADR 0021).
  await button(page, 'Открыть курс').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Английский по уровням' })).toBeFocused();
  await expect(deckRow(page, 'Основа')).toHaveAccessibleName(/A1–A2 · 0 из 100 5 новых 0 изучаемых 0 к повторению/);
  // Later levels wait for the one before.
  await expect(deckRow(page, 'Уверенный уровень')).toHaveAccessibleName(/после уровня «Основа» закрыта/);
  await expect(deckRow(page, 'Продвинутый уровень')).toHaveAccessibleName(/закрыта/);
  // No button that studies everything: a lesson is always one deck's (ADR 0020).
  await expect(page.getByRole('button', { name: /^(Начать урок|Учить|Продолжить урок)/ })).toHaveCount(0);

  await openDeck(page);
  await expect(today(page)).toHaveText('Сегодня 5\u00a0новых слов.');
  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
  await button(page, 'На главную').click();
  // Back on the deck's page: today's new words are done; what is left is a bonus.
  await expect(page.getByRole('heading', { level: 1, name: 'Основа' })).toBeVisible();
  await expect(today(page)).toHaveText('На сегодня всё. Можно взять ещё слов.');
  await expect(page.getByText(/5\s*из 100\sслов встречено/)).toBeVisible();
  await expect(button(page, 'Ещё 5 слов')).toBeVisible();

  await learner.travelTo(new Date(Date.now() + 10 * DAY));
  await page.reload();
  await button(page, 'Открыть курс').click();
  await expect(deckRow(page, 'Основа')).toHaveAccessibleName(/5 новых 0 изучаемых 5 к повторению/);
  await openDeck(page);
  await expect(today(page)).toHaveText('Сегодня 5\u00a0новых слов и 5 на повторение.');
  // Reviews first; leaving the lesson comes back to the deck, where it can be resumed.
  await page.getByRole('button', { name: /^Учить · 5 повт\. \+ 5 нов\./ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('buy');
  await page.getByRole('button', { name: 'Выйти из урока' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Основа' })).toBeVisible();
  await expect(button(page, 'Продолжить урок')).toBeVisible();
  await expect(today(page)).toHaveText('Урок начат — продолжите с того места, где остановились.');
});

test('a locked level is not pressable and says what opens it', async ({ page }) => {
  await page.goto('/');
  await button(page, 'Открыть курс').click();
  await expect(deckRow(page, 'Уверенный уровень')).toBeDisabled();
  await expect(deckRow(page, 'Продвинутый уровень')).toBeDisabled();
  await expect(deckRow(page, 'Уверенный уровень')).toContainText('после уровня «Основа»');
});

test("after today's target, a deck's page offers a bonus lesson", async ({ page }) => {
  await page.goto('/');
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
  await button(page, 'На главную').click();
  await expect(today(page)).toHaveText('На сегодня всё. Можно взять ещё слов.');
  await button(page, 'Ещё 5 слов').click();
  await expect(page.getByRole('button', { name: 'Показать ответ' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('house'); // the next words
});
