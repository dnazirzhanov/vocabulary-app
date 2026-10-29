import { button, expect, test } from './learner.ts';

test.describe('a learner who has not chosen a pace', () => {
  test.use({ onboarded: false });

  test('sees the promise, picks a pace, sees the plan and starts with a warm-up', async ({ page, learner }) => {
    await learner.travelTo(new Date('2026-11-02T09:00:00Z')); // a Monday
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '1 300 слов' })).toBeFocused();
    await expect(page.getByText('около 80% всех слов')).toBeVisible();
    await expect(page.getByText('9 из 11 слов — из списка 1 300')).toBeVisible();
    await button(page, 'Выбрать темп').click();

    await expect(page.getByRole('heading', { name: 'Сколько новых слов в день?' })).toBeFocused();
    // A big target spells out its cost once reviews add up, and offers a warm-up.
    await page.getByRole('slider').fill('30');
    await expect(page.getByText('Через месяц это ≈ 1 ч 05 мин каждый день.')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Разогрев/ })).toBeChecked();
    await page.getByRole('radio', { name: /Быстрый/ }).check();
    await expect(page.getByText(/Через месяц/)).toHaveCount(0);
    await page.getByRole('radio', { name: '5', exact: true }).check();
    await button(page, 'Дальше: мой план').click();

    // 10 a day with the warm-up (5, then 8), weekdays only. Each day shows the running total
    // toward the 1,300-word course goal.
    await expect(page.getByRole('heading', { name: 'Ваш план' })).toBeFocused();
    await expect(page.getByText(/^1\s300\sслов — к\s\d+ \S+ 2027 г\.$/)).toBeVisible();
    await expect(
      page.getByRole('cell', { name: /^понедельник, 2 ноября, сегодня, вы будете знать 5\sслов$/ }),
    ).toBeVisible();
    await expect(page.getByRole('cell', { name: /^пятница, 6 ноября, вы будете знать 25\sслов$/ })).toBeVisible();
    await expect(
      page.getByRole('cell', { name: /^суббота, 7 ноября, вы будете знать 25\sслов, выходной$/ }),
    ).toBeVisible();
    // 33, 41, 49, then 57 on Thursday the 12th: the first round number on the way.
    await expect(
      page.getByRole('cell', { name: /^четверг, 12 ноября, вы будете знать 57\sслов, рубеж: 50\sслов$/ }),
    ).toBeVisible();
    // Five weeks at a time, from this week: 2 November – 6 December, then the next five.
    await expect(page.getByRole('heading', { name: /^2 нояб\.? – 6 дек\.?$/ })).toBeVisible();
    await page.getByRole('button', { name: 'Следующие недели' }).click();
    await expect(page.getByRole('heading', { name: /^7 дек\.? – 10 янв\.?$/ })).toBeVisible();
    await button(page, 'Начать').click();

    await expect(page.getByText('Разогрев, неделя 1 из 2: сегодня цель 5 из 10.')).toBeVisible();
    await expect(button(page, 'Начать урок · 5 слов')).toBeVisible();
  });
});

test('the plan screen tries a pace and saves it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Ваш план/ }).click();
  await expect(page.getByRole('heading', { name: 'Ваш план' })).toBeFocused();
  const today = page.getByRole('cell', { name: /сегодня/ });
  await expect(today).toHaveAccessibleName(/вы будете знать 5\sслов/);

  // Trying a pace redraws the calendar at once; nothing is saved until asked.
  await page.getByRole('button', { name: 'Больше' }).click();
  await expect(today).toHaveAccessibleName(/вы будете знать 6\sслов/);
  await page.getByRole('button', { name: '3', exact: true }).click();
  await expect(today).toHaveAccessibleName(/вы будете знать 3\sслова/);
  await button(page, 'Сохранить темп').click();
  await expect(button(page, 'Сохранить темп')).toHaveCount(0);

  await button(page, 'На главную').click();
  await expect(page.getByText(/Сегодня: 0 из 3/)).toBeVisible();
  await expect(button(page, 'Начать урок · 3 слова')).toBeVisible();
});
