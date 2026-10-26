import { answer, button, expect, test } from './learner.ts';

const DAY = 86_400_000;

test('a learner returns the next day and reviews the words due', async ({ page, learner }) => {
  await page.goto('/');
  await button(page, 'Начать урок · 5 слов').click();
  for (let step = 0; step < 15; step += 1) await answer(page);
  await expect(page.getByText('Первое повторение — завтра')).toBeVisible();
  await button(page, 'На главную').click();
  await expect(page.getByText('Следующее повторение — завтра')).toBeVisible();

  await learner.travelTo(new Date(Date.now() + DAY + 60_000));
  await page.reload();
  await expect(page.getByText('Пора повторить 5 слов')).toBeVisible();
  await button(page, 'Повторить слова · 5').click();

  // Recall comes before the options: nothing to pick until the learner asks to see them.
  await expect(page.getByText('Вспомните перевод')).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await answer(page, { correct: false }); // "house" is not recalled
  for (let step = 0; step < 9; step += 1) await answer(page);

  await expect(page.getByRole('heading', { name: 'Повторение пройдено' })).toBeVisible();
  await expect(page.getByText('Вы вспомнили 4 из 5 слов спустя время')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Вспомнили/ })).toBeVisible();

  await button(page, 'На главную').click();
  await expect(page.getByText('Следующее повторение — завтра')).toBeVisible(); // "house" returns tomorrow
  await expect(button(page, 'Новые слова · 5')).toBeVisible();
});
