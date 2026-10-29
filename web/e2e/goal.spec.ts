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

    // 10 a day with the warm-up (5, then 8), weekdays only: 25 words this week, the rest on Monday.
    await expect(page.getByRole('heading', { name: 'Ваш план' })).toBeFocused();
    await expect(page.getByText('к 9 ноября')).toBeVisible();
    await expect(page.getByText('≈ к 20 ноября')).toBeVisible();
    // The calendar: words known at the end of each day, rest days at the weekend, the finish.
    await expect(page.getByRole('cell', { name: /^понедельник, 2 ноября, сегодня, вы знаете 5 слов/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /^пятница, 6 ноября, вы знаете 25 слов, новых: 5$/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /^суббота, 7 ноября, вы знаете 25 слов, отдых$/ })).toBeVisible();
    await expect(
      page.getByRole('cell', { name: /9 ноября, вы знаете 30 слов.*все слова колоды пройдены/ }),
    ).toBeVisible();
    await expect(page.getByRole('cell', { name: /20 ноября.*все слова хорошо запомнены/ })).toBeVisible();
    await button(page, 'Начать').click();

    await expect(page.getByText('Разогрев, неделя 1 из 2: сегодня цель 5 из 10.')).toBeVisible();
    await expect(button(page, 'Начать урок · 5 слов')).toBeVisible();
  });
});

test('the pace can be changed later from home', async ({ page }) => {
  await page.goto('/');
  await button(page, 'Цель').click();
  await expect(page.getByRole('heading', { name: 'Мой темп' })).toBeFocused();
  await expect(button(page, 'Сохранить')).toBeDisabled();

  await page.getByRole('radio', { name: /Спокойный/ }).check();
  await button(page, 'Сохранить').click();
  await expect(page.getByText(/Сегодня: 0 из 3/)).toBeVisible();
  await expect(button(page, 'Начать урок · 3 слова')).toBeVisible();
});
