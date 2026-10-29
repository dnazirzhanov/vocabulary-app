import { button, expect, finishSession, study, test } from './learner.ts';

test('a new learner studies five flashcards and the progress survives a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('0 из 30 слов')).toBeVisible();
  await button(page, 'Начать урок · 5 слов').click();

  // The front shows only the word; the answer appears on request, with the ratings.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('house');
  await expect(page.getByText('Новое слово')).toBeVisible();
  await expect(page.getByText('дом')).toHaveCount(0);
  await button(page, 'Показать ответ').click();
  await expect(page.getByText('дом', { exact: true })).toBeVisible();
  await expect(page.getByText('They live in a small house near the river.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Снова\s*1 мин/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Хорошо\s*10 мин/ })).toBeVisible();
  await page.getByRole('button', { name: /^Хорошо/ }).click();

  await finishSession(page, { water: 'Легко' });
  await expect(page.getByRole('heading', { name: 'Отличная память!' })).toBeVisible();
  await expect(page.getByText(/^Новых — 5\sслов/)).toBeVisible();
  await button(page, 'На главную').click();

  await page.reload();
  await expect(page.getByText('5 из 30 слов')).toBeVisible();
  await expect(button(page, 'Ещё 5 слов')).toBeVisible(); // the daily target is met: a bonus lesson
});

test('a card rated «Снова» comes back later in the same session', async ({ page }) => {
  await page.goto('/');
  await button(page, 'Начать урок · 5 слов').click();
  await study(page, 'Снова'); // house
  await study(page, 'Легко'); // water
  await study(page, 'Легко'); // friend
  await study(page, 'Легко'); // buy
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('house');
  await expect(page.getByText('Вспомните перевод')).toBeVisible();
});

test('the keyboard works like Anki: Space shows the answer, number keys rate', async ({ page }) => {
  await page.goto('/');
  await button(page, 'Начать урок · 5 слов').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('house');
  await page.keyboard.press('Space');
  await expect(page.getByText('дом', { exact: true })).toBeVisible();
  await page.keyboard.press('4');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('water');
});

test('an unfinished session resumes where the learner left off', async ({ page }) => {
  await page.goto('/');
  await button(page, 'Начать урок · 5 слов').click();
  await study(page, 'Легко');
  await study(page, 'Легко');
  await page.reload();
  await button(page, 'Продолжить урок').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('friend');
});

test('hard words are summarised and can be practised straight away', async ({ page }) => {
  await page.goto('/');
  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page, { house: 'Снова' });
  await expect(page.getByRole('heading', { name: 'Готово!' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Трудные сейчас/ })).toBeVisible();
  await button(page, 'Повторить трудные').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('house');
});

test('a lost connection keeps the rating and the learner can retry', async ({ page }) => {
  await page.goto('/');
  await button(page, 'Начать урок · 5 слов').click();
  await page.route('**/attempts', (route) => route.abort('internetdisconnected'));
  await button(page, 'Показать ответ').click();
  await page.getByRole('button', { name: /^Легко/ }).click();
  await expect(page.getByText('Нет связи с сервером')).toBeVisible();

  await page.unroute('**/attempts');
  await button(page, 'Повторить').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('water');
});
