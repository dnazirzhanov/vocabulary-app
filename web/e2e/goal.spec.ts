import { button, expect, openDeck, test } from './learner.ts';

test.describe('a learner who has not chosen a pace', () => {
  test.use({ onboarded: false });

  test('answers two small questions, one at a time, and starts', async ({ page, learner }) => {
    await learner.travelTo(new Date('2026-11-02T09:00:00Z')); // a Monday
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Сколько новых слов в день?' })).toBeFocused();
    // Only the question and its answers: no pitch, no picture, no sums.
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(4);
    await expect(page.getByRole('main').getByRole('img')).toHaveCount(0);
    await expect(page.getByText(/мин|NGSL|Разогрев/)).toHaveCount(0);
    await expect(page.getByRole('main').locator('p')).toHaveCount(0);

    // Tapping an answer is enough; going back shows it still chosen.
    await page.getByRole('button', { name: /^10\sслов$/ }).click();
    await expect(page.getByRole('heading', { name: 'В какие дни будете заниматься?' })).toBeFocused();
    await button(page, 'Назад').click();
    await expect(page.getByRole('button', { name: /^10\sслов$/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /^10\sслов$/ }).click();

    // Пн–Сб until chosen, and a preset narrows them (ADR 0039).
    await expect(button(page, 'Сб')).toHaveAttribute('aria-pressed', 'true');
    await button(page, 'Пн–Пт').click();
    await expect(button(page, 'Сб')).toHaveAttribute('aria-pressed', 'false');
    await button(page, 'Начать').click();

    // A development build has no sign-in to leave.
    await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
    await expect(button(page, 'Выйти')).toHaveCount(0);

    // The warm-up stays on by default, and the deck's page says what it does.
    await openDeck(page);
    await expect(page.getByText(/^В день: 10\u00a0новых слов · пока 5, разогрев/)).toBeVisible();
    await expect(button(page, 'Начать урок · 5 слов')).toBeVisible();
    // The promise reads on «Прогресс»; nothing is finished yet, so it applies from today.
    await button(page, 'Прогресс').click();
    await expect(page.getByText(/Обещание: Пн–Пт/)).toBeVisible();
  });
});
