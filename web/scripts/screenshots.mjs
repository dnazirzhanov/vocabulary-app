// Captures the lesson screen in each state at the design's target viewports,
// using the locally installed Chrome. Start the dev server first (npm run dev).
//   npm run screenshots            → web/screenshots/*.png + a layout report
//   BASE_URL=http://… npm run screenshots
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:5173/';
const outDir = fileURLToPath(new URL('../screenshots/', import.meta.url));

const viewports = [
  { name: '320-small-mobile', width: 320, height: 568, mobile: true },
  { name: '390-mobile', width: 390, height: 844, mobile: true },
  { name: '768-tablet', width: 768, height: 1024, mobile: true },
  { name: '1280-desktop', width: 1280, height: 800 },
  { name: '1440-desktop', width: 1440, height: 900 },
];

// Layout problems the eye can miss in a screenshot.
function inspect() {
  const doc = document.documentElement;
  const footer = document.querySelector('footer')?.getBoundingClientRect();
  const main = document.querySelector('main');
  const hidden = [...document.querySelectorAll('fieldset label')]
    .filter((label) => footer && label.getBoundingClientRect().bottom > footer.top + 1)
    .map((label) => label.textContent.trim());
  const stage = document.querySelector('figure')?.getBoundingClientRect();
  return {
    horizontalOverflow: doc.scrollWidth > window.innerWidth,
    mainScrollsBy: main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0,
    optionsBelowFold: hidden,
    stage: stage ? `${Math.round(stage.width)}×${Math.round(stage.height)}` : null,
  };
}

function fontReport() {
  const loaded = [...document.fonts].filter((face) => face.status === 'loaded');
  return {
    nunitoCyrillic: document.fonts.check('600 18px "Nunito Variable"', 'резиновые сапоги'),
    loadedFaces: loaded.map((face) => `${face.family} [${face.unicodeRange.slice(0, 24)}…]`),
  };
}

const browser = await chromium.launch({ channel: 'chrome' });
await mkdir(outDir, { recursive: true });
const report = {};

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.mobile ? 2 : 1,
      isMobile: viewport.mobile ?? false,
      hasTouch: viewport.mobile ?? false,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

    const states = {};
    const shot = async (state) => {
      await page.screenshot({ path: `${outDir}${viewport.name}-${state}.png`, animations: 'disabled' });
      states[state] = await page.evaluate(inspect);
    };

    await page.goto(baseUrl);
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.evaluate(() => document.fonts.ready);

    await shot('1-idle');
    await page.getByRole('radio', { name: 'шляпа' }).click();
    await shot('2-selected');
    await page.getByRole('button', { name: 'Проверить' }).click();
    await shot('3-incorrect');
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.getByRole('radio', { name: 'чайник' }).click();
    await page.getByRole('button', { name: 'Проверить' }).click();
    await shot('4-correct');

    report[viewport.name] = { states, fonts: await page.evaluate(fontReport), errors };
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
console.log(`Screenshots: ${outDir}`);
