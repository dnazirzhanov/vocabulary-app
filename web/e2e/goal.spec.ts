import { button, expect, openDeck, test } from './learner.ts';

test.describe('a learner who has not chosen a pace', () => {
  test.use({ onboarded: false });

  test('sees the promise, picks a pace and starts with a warm-up', async ({ page, learner }) => {
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
    // The days are weekdays now (ADR 0039): Пн–Сб until chosen, a preset narrows them.
    await expect(button(page, 'Сб')).toHaveAttribute('aria-pressed', 'true');
    await button(page, 'Пн–Пт').click();
    await expect(button(page, 'Сб')).toHaveAttribute('aria-pressed', 'false');
    await button(page, 'Начать').click();

    await openDeck(page);
    await expect(page.getByText(/^В день: 10\u00a0новых слов · пока 5, разогрев/)).toBeVisible();
    await expect(button(page, 'Начать урок · 5 слов')).toBeVisible();
    // The promise reads on «Прогресс»; nothing is finished yet, so it applies from today.
    await button(page, 'Прогресс').click();
    await expect(page.getByText(/Обещание: Пн–Пт/)).toBeVisible();
  });
});
