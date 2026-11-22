import type { Page } from '@playwright/test';
import { expect, test } from './learner.ts';

/**
 * Shadowing against the real API and the real exercise («Anna's First Day», loaded by
 * `app.cli load-shadowing`). The browser's fake microphone stands in for the learner's voice.
 */
test.use({
  speaker: true,
  viewport: { width: 390, height: 844 },
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  permissions: ['microphone'],
});

async function openAnna(page: Page) {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Речь' }).click();
  await page
    .getByRole('button', { name: /Шэдоуинг/ })
    .first()
    .click();
  await page.getByRole('button', { name: /Anna's First Day/ }).click();
  await expect(page.getByRole('heading', { name: "Anna's First Day" })).toBeVisible();
}

/** Every <audio> on the page: whether it is playing and where it is. */
const audios = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('audio')].map((a) => ({ paused: a.paused, at: a.currentTime })));

const savedAttempts = async (page: Page) => {
  const exercises = (await (await page.request.get('/api/shadowing/exercises')).json()) as {
    id: string;
    slug: string;
  }[];
  const anna = exercises.find((e) => e.slug === 'anna-hello')!;
  return (await (await page.request.get(`/api/shadowing/exercises/${anna.id}/my-attempts`)).json()) as {
    completed_at: string | null;
    has_audio: boolean;
  }[];
};

test('the controls sit above the tab bar, and the spoken sentence is marked as it plays', async ({ page }) => {
  await openAnna(page);
  // The main action was half hidden behind the tab bar: the screen was sized to the window.
  const start = await page.getByRole('button', { name: 'Начать шэдоуинг' }).boundingBox();
  const nav = await page.getByRole('navigation').first().boundingBox();
  expect(start!.y + start!.height).toBeLessThanOrEqual(nav!.y);
  // The length is known before anything plays (it used to read 0:00).
  await expect(page.getByText('0:00 / 0:43')).toBeVisible();

  // Tapping a sentence plays from it, and that sentence is the marked one.
  const marsha = page.getByRole('button', { name: /I live with Marsha/ });
  await marsha.click();
  await expect(marsha).toHaveAttribute('aria-current', 'true');
  const [original] = await audios(page);
  expect(original.paused).toBe(false);
  expect(original.at).toBeGreaterThanOrEqual(14);
});

test('shadowing records along with the original; only a saved attempt is kept', async ({ page }) => {
  await openAnna(page);

  // Cancel stops the microphone and leaves nothing behind.
  await page.getByRole('button', { name: 'Начать шэдоуинг' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Запись' })).toBeVisible();
  await expect.poll(async () => (await audios(page))[0].paused).toBe(false); // the original plays with it
  await page.getByRole('button', { name: 'Отмена' }).click();
  await expect(page.getByRole('button', { name: 'Начать шэдоуинг' })).toBeEnabled();
  expect(await savedAttempts(page)).toHaveLength(0);
  expect((await audios(page)).every((a) => a.paused)).toBe(true);

  // Again, then stop early: the original and the recording side by side, each with its length.
  await page.getByRole('button', { name: 'Начать шэдоуинг' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Запись 0:0[2-9]/ })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Стоп' }).click();
  await expect(page.getByText('Ваша запись')).toBeVisible();
  // A fresh WebM recording reports no length of its own; it must not read 0:00 or ∞.
  await expect(page.getByText(/^0:00 \/ 0:0[1-9]$/)).toBeVisible();
  expect(await savedAttempts(page)).toHaveLength(0); // nothing saved until asked

  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Сохранено')).toBeVisible();
  const saved = await savedAttempts(page);
  expect(saved).toHaveLength(1);
  expect(saved[0].completed_at).not.toBeNull();
  expect(saved[0].has_audio).toBe(true);

  // A saved attempt plays with one tap; starting the original then pauses it: one sound at a time.
  await page.getByRole('button', { name: /Попытка 1/ }).click();
  await expect.poll(async () => (await audios(page)).filter((a) => !a.paused).length).toBe(1);
  await page.getByRole('button', { name: 'Слушать' }).last().click();
  await expect.poll(async () => (await audios(page))[0].paused).toBe(false);
  await expect.poll(async () => (await audios(page)).filter((a) => !a.paused).length).toBe(1);
});
