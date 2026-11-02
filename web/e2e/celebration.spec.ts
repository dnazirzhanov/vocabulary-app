import type { Page } from '@playwright/test';
import { button, expect, finishSession, openDeck, openSettings, spell, test } from './learner.ts';

/**
 * The page's tones, counted: every oscillator started is a note played (lib/sounds.ts). Installed
 * before the app loads, so it sees every AudioContext.
 */
async function countNotes(page: Page) {
  await page.addInitScript(() => {
    const started = { notes: 0 };
    (window as unknown as { started: typeof started }).started = started;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args: Parameters<typeof start>) {
      started.notes += 1;
      return start.apply(this, args);
    };
  });
}
const notes = (page: Page) => page.evaluate(() => (window as unknown as { started: { notes: number } }).started.notes);

test('flashcards stay quiet; the finish celebrates with confetti and a chord', async ({ page }) => {
  await countNotes(page);
  await page.goto('/');
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  // Five new cards, rated: no sound for learning a word from a deck.
  await finishSession(page);
  await expect(page.locator('[data-celebration]')).toBeAttached();
  // Exactly the finishing chord — 4 arpeggio notes, 5 chord notes, 3 sparkles, two tones each —
  // so the five rated cards made no sound.
  await expect.poll(() => notes(page)).toBe(24);
  const atFinish = await notes(page);

  // Spelling: each word right on the first try rings a chime (two notes, two partials each).
  await button(page, 'Правописание · 5 слов').click();
  await spell(page);
  await expect.poll(() => notes(page)).toBe(atFinish + 4);
  // The confetti is gone after a few seconds and never catches a tap.
  await expect(page.locator('[data-celebration]')).toHaveCount(0);
});

test('sounds can be turned off in the settings on «Прогресс»', async ({ page }) => {
  await countNotes(page);
  await page.goto('/');
  await openSettings(page);
  const sounds = page.getByRole('switch', { name: /Звуки/ });
  await expect(sounds).toBeChecked();
  await sounds.uncheck();
  await page.keyboard.press('Escape');
  await button(page, 'Сегодня').click();
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await finishSession(page);
  // Confetti still falls; nothing is heard.
  await expect(page.locator('[data-celebration]')).toBeAttached();
  expect(await notes(page)).toBe(0);
});
