// Captures every screen and exercise state at the design's target viewports, using the locally
// installed Chrome. Needs the API and the web dev server running (`make dev`).
//   npm run screenshots            → web/screenshots/*.png + a layout report
//   BASE_URL=http://… npm run screenshots
// Each viewport uses a fresh development user (X-Dev-User), so runs never share progress.
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:5173/';
const outDir = fileURLToPath(new URL('../screenshots/', import.meta.url));
const wordsFile = fileURLToPath(new URL('../../content/a1-a2/words.yaml', import.meta.url));

const viewports = [
  { name: '320-small-mobile', width: 320, height: 568, mobile: true },
  { name: '390-mobile', width: 390, height: 844, mobile: true, picture: true, review: true },
  { name: '768-tablet', width: 768, height: 1024, mobile: true },
  { name: '1280-desktop', width: 1280, height: 800, picture: true, review: true },
  { name: '1440-desktop', width: 1440, height: 900 },
];

// The deck format is controlled by us, so two fields per entry can be read without a YAML parser.
async function loadAnswers() {
  const text = await readFile(wordsFile, 'utf8');
  const translationOf = {};
  for (const entry of text.split(/^- id: /m).slice(1)) {
    const headword = entry.match(/^ {2}headword: (.+)$/m)[1].trim();
    translationOf[headword] = entry.match(/^ {2}translation: (.+)$/m)[1].trim();
  }
  const headwordFor = Object.fromEntries(Object.entries(translationOf).map(([h, t]) => [t, h]));
  return { translationOf, headwordFor };
}

// Plays whole study sessions through the API (same user as the page), rating every card «Легко».
async function fastForward(request, lessons, _answers, headers) {
  for (let n = 0; n < lessons; n += 1) {
    const response = await request.post('/api/sessions', { data: { kind: 'study' }, headers });
    const session = await response.json();
    for (const card of session.exercises) {
      await request.post(`/api/sessions/${session.id}/attempts`, {
        data: { exercise_id: card.id, response: { kind: 'rating', rating: 4 } },
        headers,
      });
    }
    await request.post(`/api/sessions/${session.id}/complete`, { headers });
  }
}

// Layout problems the eye can miss in a screenshot.
function inspect() {
  const doc = document.documentElement;
  const footer = document.querySelector('footer')?.getBoundingClientRect();
  const main = document.querySelector('main');
  const hidden = [...document.querySelectorAll('fieldset label, main input')]
    .filter((el) => footer && el.getBoundingClientRect().bottom > footer.top + 1)
    .map((el) => el.textContent.trim() || el.getAttribute('placeholder'));
  const stage = document.querySelector('figure')?.getBoundingClientRect();
  return {
    horizontalOverflow: doc.scrollWidth > window.innerWidth,
    mainScrollsBy: main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0,
    controlsBelowFold: hidden,
    stage: stage ? `${Math.round(stage.width)}×${Math.round(stage.height)}` : null,
  };
}

function fontReport() {
  return { nunitoCyrillic: document.fonts.check('600 18px "Nunito Variable"', 'резиновые сапоги') };
}

const answers = await loadAnswers();
const browser = await chromium.launch({ channel: 'chrome' });
await mkdir(outDir, { recursive: true });
const report = {};

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.mobile ? 2 : 1,
      isMobile: viewport.mobile ?? false,
      hasTouch: viewport.mobile ?? false,
    });
    let headers = { 'X-Dev-User': `shots-${viewport.width}-${Date.now()}` };
    await context.setExtraHTTPHeaders(headers);
    // Past the first-run screens with the default pace (5 a day); they have their own captures below.
    await context.request.patch('/api/me', { data: { daily_target_words: 5 } });
    // Moves the server clock (development only) so the next day's reviews can be captured.
    const travelTo = async (moment) => {
      headers = { ...headers, 'X-Dev-Now': moment.toISOString() };
      await context.setExtraHTTPHeaders(headers);
    };
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

    const states = {};
    const shot = async (state) => {
      await page.screenshot({ path: `${outDir}${viewport.name}-${state}.png`, animations: 'disabled' });
      states[state] = await page.evaluate(inspect);
    };
    const button = (name) => page.getByRole('button', { name, exact: true });
    const heading = () => page.getByRole('heading', { level: 1 });

    // Shows the answer of the card on screen and rates it; waits for the next card or the summary.
    const study = async (rating = 'Хорошо') => {
      const id = await page.locator('[data-card]').getAttribute('data-card');
      await button('Показать ответ').click();
      await page.getByRole('button', { name: new RegExp(`^${rating}`) }).click();
      await page.locator(`[data-card="${id}"]`).waitFor({ state: 'detached' });
    };
    const finish = async (first = {}) => {
      const seen = new Set();
      while (!(await button('На главную').isVisible())) {
        const word = (await heading().textContent()) ?? '';
        await study(seen.has(word) ? 'Хорошо' : (first[word] ?? 'Хорошо'));
        seen.add(word);
        await page.waitForTimeout(50);
      }
    };

    try {
      await page.goto('/');
      await button('Начать урок · 5 слов').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await shot('01-home');

      await button('Начать урок · 5 слов').click();
      await button('Показать ответ').waitFor();
      await shot('02-card-front');
      await button('Показать ответ').click();
      await shot('03-card-back');
      await page.getByRole('button', { name: /^Снова/ }).click();
      await finish();
      await shot('04-summary');
      await button('На главную').click();
      await page.getByRole('button', { name: /^(Новые слова|Ещё)/ }).waitFor();
      await shot('05-home-progress');
      await button('Прогресс').click();
      await page.getByRole('heading', { name: 'Прогресс' }).waitFor();
      await shot('06-progress');
      await button('Сегодня').click();

      if (viewport.review) {
        // Ten days later: the five words met above are due and come first.
        await travelTo(new Date(Date.now() + 10 * 86_400_000));
        await page.reload();
        await page.getByText('Пора повторить').waitFor();
        await shot('07-home-review');
        await page.getByRole('button', { name: /^Учить/ }).click();
        await button('Показать ответ').waitFor();
        await shot('08-review-front');
        await finish();
        await shot('09-summary-review');
        await button('На главную').click();
      }

      if (viewport.picture) {
        // Up to word 20 via the API; the next lesson's third new word ("key") has a picture.
        const known = async () =>
          (await (await context.request.get('/api/decks', { headers })).json()).reduce(
            (sum, deck) => sum + deck.introduced_count,
            0,
          );
        while ((await known()) < 20) await fastForward(context.request, 1, answers, headers);
        await page.reload();
        await page.getByRole('button', { name: /^(Новые слова|Ещё|Учить)/ }).click();
        while (!(await heading().filter({ hasText: /^key$/ }).isVisible())) await study('Легко');
        await button('Показать ответ').click();
        await shot('10-card-picture');
      }
    } catch (error) {
      // Leave evidence of where the walk broke, then stop.
      await page.screenshot({ path: `${outDir}${viewport.name}-FAILED.png` });
      console.error(`${viewport.name}: walk failed on screen`, await page.getByRole('button').allTextContents());
      throw error;
    }

    report[viewport.name] = { states, fonts: await page.evaluate(fontReport), errors };
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
console.log(`Screenshots: ${outDir}`);
