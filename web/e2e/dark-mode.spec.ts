import { type Page } from '@playwright/test';
import { expect, test } from './learner.ts';

// The app is designed light only. A phone in dark mode must not darken it on its own (Android
// Chrome's auto dark theme, Samsung Internet): index.html and tokens.css say "only light". The
// browser here is started with that darkening forced on, as such a phone would have it.
test.use({
  colorScheme: 'dark',
  viewport: { width: 390, height: 844 },
  launchOptions: { args: ['--blink-settings=forceDarkModeEnabled=true,darkModeInversionAlgorithm=4'] },
});

/** The colour actually drawn at a point of the screen, read from a screenshot. */
async function drawnAt(page: Page, x: number, y: number): Promise<number[]> {
  const shot = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ({ data, x, y }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return [...context.getImageData(x, y, 1, 1).data.slice(0, 3)];
    },
    { data: shot, x, y },
  );
}

test('a phone in dark mode still shows the app in its own light colours', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  // The page's paper (#F9F9F9) in the side margin of a phone's screen, not darkened to near black.
  expect(await drawnAt(page, 4, 300)).toEqual([249, 249, 249]);
});
