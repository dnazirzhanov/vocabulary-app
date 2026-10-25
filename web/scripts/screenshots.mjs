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
const wordsFile = fileURLToPath(new URL('../../content/starter-deck/words.yaml', import.meta.url));

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

function correctResponse(exercise, answers) {
  if (exercise.type === 'introduce') return { kind: 'seen' };
  if (exercise.type === 'choose_meaning' || exercise.type === 'recall_meaning') {
    const right = answers.translationOf[exercise.word.headword];
    return { kind: 'choice', option_id: exercise.options.find((o) => o.label === right).id };
  }
  return { kind: 'text', text: answers.headwordFor[exercise.prompt.translation] };
}

// Plays whole lessons through the API (same user as the page) to reach later words quickly.
async function fastForward(request, lessons, answers, headers) {
  for (let n = 0; n < lessons; n += 1) {
    const response = await request.post('/api/sessions', { data: { kind: 'new', deck_id: 'starter' }, headers });
    const session = await response.json();
    for (const exercise of session.exercises) {
      await request.post(`/api/sessions/${session.id}/attempts`, {
        data: { exercise_id: exercise.id, response: correctResponse(exercise, answers) },
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

    // Answers the exercise on screen and stops on its feedback (introductions have none).
    const answer = async ({ correct = true } = {}) => {
      const type = await page.locator('[data-type]').getAttribute('data-type');
      if (type === 'introduce') {
        // The card stays until the server acknowledges it; wait for the next exercise to replace it.
        const card = await page.locator('[data-type]').elementHandle();
        await button('Дальше').click();
        await page.waitForFunction((element) => !element.isConnected, card);
        return type;
      }
      if (type === 'recall_meaning') await button('Показать варианты').click();
      if (type === 'choose_meaning' || type === 'recall_meaning') {
        const right = answers.translationOf[await heading().textContent()];
        const options = page.getByRole('radio');
        const labels = await options.evaluateAll((els) => els.map((el) => el.closest('label').textContent));
        await options.nth(labels.findIndex((label) => label.endsWith(right) === correct)).click();
      } else {
        const translation = (await heading().textContent()).replace(/\s*(сущ|гл|прил|нар)\.$/, '').trim();
        const word = answers.headwordFor[translation];
        await page.getByRole('textbox').fill(correct ? word : word.slice(0, -1));
      }
      await button('Проверить').click();
      await button('Продолжить').waitFor();
      return type;
    };
    const step = async () => {
      if ((await answer()) !== 'introduce') await button('Продолжить').click();
    };

    try {
      await page.goto('/');
      await button('Начать урок').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await shot('01-home');

      await button('Начать урок').click();
      await page.getByText('Новое слово').waitFor();
      await shot('02-introduce');
      await button('Дальше').click();
      await page.getByText('Выберите перевод').waitFor();
      await shot('03-choose');
      await answer({ correct: false });
      await shot('04-choose-incorrect');
      await button('Продолжить').click();
      await step(); // introduce "water"
      await answer();
      await shot('05-choose-correct');
      await button('Продолжить').click();
      while (!(await page.getByText('Напишите по-английски').isVisible())) await step();
      await shot('06-type');
      await answer({ correct: false });
      await shot('07-type-incorrect');
      await button('Продолжить').click();
      for (let i = 0; i < 4; i += 1) await step();
      await heading()
        .filter({ hasText: /Урок пройден|Без единой ошибки/ })
        .waitFor();
      await shot('08-summary');
      await button('На главную').click();
      await button('Новые слова').waitFor();
      await shot('09-home-progress');
      await button('Прогресс').click();
      await page.getByRole('heading', { name: 'Прогресс' }).waitFor();
      await shot('09b-progress');
      await button('На главную').click();
      await button('Новые слова').waitFor();

      if (viewport.review) {
        // The next day: the five words met above are due.
        await travelTo(new Date(Date.now() + 86_400_000 + 60_000));
        await page.reload();
        await page.getByText('Пора повторить').waitFor();
        await shot('11-home-review');
        await page.getByRole('button', { name: /Повторить слова/ }).click();
        await page.getByText('Вспомните перевод').waitFor();
        await shot('12-recall');
        await button('Показать варианты').click();
        await shot('13-recall-revealed');
        await page.getByRole('radio').first().click();
        await button('Проверить').click();
        await button('Продолжить').click();
        for (let i = 0; i < 9; i += 1) await step();
        await heading()
          .filter({ hasText: /Повторение пройдено|Отличная память/ })
          .waitFor();
        await shot('14-summary-review');
        await button('На главную').click();
        await button('Прогресс').click();
        await page.getByText('Вспомнили на повторениях').waitFor();
        await shot('15-progress-after-review');
        await button('На главную').click();
        await button('Новые слова').waitFor();
      }

      if (viewport.picture) {
        // Words 6–20 via the API; the next lesson's third new word ("key") has a picture.
        await fastForward(context.request, 3, answers, headers);
        await page.reload();
        await button('Новые слова').click();
        while (!(await heading().filter({ hasText: /^key$/ }).isVisible())) await step();
        await shot('10-introduce-picture');
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
