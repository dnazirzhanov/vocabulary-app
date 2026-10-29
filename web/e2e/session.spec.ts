import { answer, button, expect, test } from './learner.ts';

test('a new learner completes a session and the progress survives a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('0 из 30 слов')).toBeVisible();
  await button(page, 'Начать урок · 5 слов').click();

  for (let step = 0; step < 15; step += 1) await answer(page);

  await expect(page.getByRole('heading', { name: 'Без единой ошибки!' })).toBeVisible();
  await expect(page.getByText('Вы познакомились с 5 новыми словами')).toBeVisible();
  await button(page, 'На главную').click();

  await page.reload();
  await expect(page.getByText('5 из 30 слов')).toBeVisible();
  await expect(button(page, 'Ещё 5 слов')).toBeVisible(); // the daily target is met: a bonus lesson
});

test('an unfinished session resumes where the learner left off', async ({ page }) => {
  await page.goto('/');
  await button(page, 'Начать урок · 5 слов').click();
  for (let step = 0; step < 3; step += 1) await answer(page);
  await expect(page.getByText('3 / 15')).toBeVisible();

  await page.reload();
  await button(page, 'Продолжить урок').click();
  await expect(page.getByText('3 / 15')).toBeVisible();
  await expect(page.getByText('Выберите перевод')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('water');
});

test('mistakes are summarised and can be practised straight away', async ({ page }) => {
  await page.goto('/');
  await button(page, 'Начать урок · 5 слов').click();
  await answer(page); // introduce house
  await answer(page, { correct: false }); // choose_meaning house
  for (let step = 0; step < 13; step += 1) await answer(page);

  await expect(page.getByRole('heading', { name: 'Урок пройден!' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Стоит повторить/ })).toBeVisible();
  await button(page, 'Повторить ошибки').click();
  await expect(page.getByText('0 / 2')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('house');
});

test('a lost connection keeps the answer and the learner can retry', async ({ page }) => {
  await page.goto('/');
  await button(page, 'Начать урок · 5 слов').click();
  await answer(page);

  await page.route('**/attempts', (route) => route.abort('internetdisconnected'));
  await page.getByRole('radio', { name: 'дом' }).click();
  await button(page, 'Проверить').click();
  await expect(page.getByText('Нет связи с сервером')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'дом' })).toBeChecked();

  await page.unroute('**/attempts');
  await button(page, 'Повторить').click();
  await expect(page.getByText('Верно!')).toBeVisible();
});
