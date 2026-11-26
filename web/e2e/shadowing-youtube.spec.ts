import type { Page } from '@playwright/test';
import { DEMO, expect, named, test } from './learner.ts';

/**
 * Shadowing from a YouTube video (ADR 0097, 0098) for a learner who isn't a Speaking tester: it
 * is everyone's. YouTube isn't reached from tests: its player script is replaced by a stand-in with
 * the same API that keeps time by itself, and the server's look at YouTube (oEmbed) is answered
 * here; the backend tests check that call.
 */
test.use({
  viewport: { width: 390, height: 844 },
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  permissions: ['microphone'],
});

const VIDEO = 'abcdefghijk';

/** YouTube's IFrame API, as a stand-in: plays by its own clock and logs what it was told. */
const FAKE_YT = `
window.__yt = { log: [] };
window.YT = {
  Player: function (el, opts) {
    const frame = document.createElement('div');
    frame.setAttribute('data-fake-youtube', opts.videoId);
    frame.style.cssText = 'width:100%;height:100%;background:#222';
    el.replaceWith(frame);
    let t = 0, state = -1, rate = 1, timer = null;
    const log = (what, value) => window.__yt.log.push([what, value]);
    const api = {
      playVideo() {
        state = 1; clearInterval(timer);
        timer = setInterval(() => { t += 0.05 * rate; }, 50);
        log('play', t); opts.events.onStateChange && opts.events.onStateChange({ data: 1 });
      },
      pauseVideo() {
        state = 2; clearInterval(timer);
        log('pause', t); opts.events.onStateChange && opts.events.onStateChange({ data: 2 });
      },
      seekTo(s) { t = s; log('seek', s); },
      setPlaybackRate(r) { rate = r; log('rate', r); },
      getCurrentTime() { return t; },
      getPlayerState() { return state; },
      destroy() { clearInterval(timer); },
    };
    setTimeout(() => {
      if (opts.videoId === 'gonegonegon') opts.events.onError && opts.events.onError({ data: 150 });
      else opts.events.onReady && opts.events.onReady();
    }, 0);
    return api;
  },
};
setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 0);
`;

async function fakeYouTube(page: Page, check: { status: number; body: unknown }) {
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: FAKE_YT }),
  );
  await page.route('https://i.ytimg.com/**', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/shadowing/youtube/check', (route) =>
    route.fulfill({ status: check.status, contentType: 'application/json', body: JSON.stringify(check.body) }),
  );
}

const VIDEO_FOUND = {
  status: 200,
  body: {
    youtube_id: VIDEO,
    title: 'Daily English: Food',
    author: 'A Teacher',
    thumbnail_url: `https://i.ytimg.com/vi/${VIDEO}/hqdefault.jpg`,
  },
};

// As YouTube's «Show transcript» panel copies it.
const PANEL = `0:00
Good morning, everyone.
0:03
Today we talk about food. What do you
0:08
like to eat?
0:11
I like apples.`;

async function openShadowing(page: Page) {
  await page.goto('/');
  // Not a Speaking tester: the tab opens shadowing itself.
  await page.getByRole('navigation').getByRole('button', { name: 'Речь' }).click();
  await expect(page.getByRole('heading', { name: 'Шэдоуинг' })).toBeVisible();
}

test('a learner pastes a link and the video’s text, picks the part and gets an exercise', async ({ page }) => {
  await fakeYouTube(page, VIDEO_FOUND);
  await openShadowing(page);
  await page.getByRole('button', { name: /Из YouTube/ }).click();

  await page.getByLabel('Ссылка из YouTube').fill(`https://youtu.be/${VIDEO}`);
  await page.getByRole('button', { name: 'Проверить' }).click();
  await expect(page.getByText('Daily English: Food')).toBeVisible();
  await expect(page.locator(`[data-fake-youtube="${VIDEO}"]`)).toBeVisible();

  // Text without times can't be used: the learner is told what to copy.
  const text = page.getByLabel('Текст со временем (0:00 …)');
  await text.fill('Good morning, everyone.');
  await expect(page.getByText('В тексте нет времени.', { exact: false })).toBeVisible();
  await text.fill(PANEL);

  // Sentences, not caption lines; the whole short video is suggested.
  const sentences = page.getByRole('list', { name: 'Предложения' }).getByRole('textbox');
  await expect(sentences).toHaveCount(4);
  await expect(sentences.nth(2)).toHaveValue('What do you like to eat?');
  await expect(page.getByText('Предложений: 4 · 0:12')).toBeVisible();

  // Only the first three; one joined with the next; one corrected.
  await page.getByLabel('По предложение').selectOption({ index: 2 });
  await page.getByRole('button', { name: 'Соединить' }).nth(1).click();
  await expect(sentences).toHaveCount(2);
  await sentences.nth(0).fill('Good morning, everybody.');
  // ▶ plays just that sentence in the video.
  await page.getByRole('button', { name: 'Послушать предложение 2' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __yt: { log: unknown[][] } }).__yt.log))
    .toContainEqual(['seek', 3]);

  await page.getByLabel('Название').fill('Food talk');
  await page.getByRole('radio', { name: 'Средний' }).check();
  await page.getByRole('button', { name: 'Сохранить упражнение' }).click();

  // Straight into practice; and it is in «Мои».
  await expect(page.getByText('Предложение 1 из 2').first()).toBeVisible();
  await expect(page.getByText('Good morning, everybody.')).toBeVisible();
  const mine = (await (await page.request.get('/api/shadowing/exercises')).json()) as {
    title: string;
    difficulty: string;
    sentences: { text: string }[];
    mine: boolean;
  }[];
  expect(mine.filter((e) => e.mine)).toEqual([
    expect.objectContaining({
      title: 'Food talk',
      difficulty: 'intermediate',
      mine: true,
      sentences: [
        expect.objectContaining({ text: 'Good morning, everybody.' }),
        expect.objectContaining({ text: 'Today we talk about food. What do you like to eat?' }),
      ],
    }),
  ]);
  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(page.getByRole('region', { name: 'Мои' }).getByText('Food talk')).toBeVisible();
});

test('sentence by sentence: listen, your turn, compare; finishing counts as done', async ({ page }) => {
  await fakeYouTube(page, VIDEO_FOUND);
  const made = await page.request.post('/api/shadowing/exercises', {
    data: {
      youtube_id: VIDEO,
      title: 'Two lines',
      difficulty: 'beginner',
      clip_start_ms: 1000,
      clip_end_ms: 3000,
      sentences: [
        { start_ms: 1000, end_ms: 2000, text: 'Hello there.' },
        { start_ms: 2000, end_ms: 3000, text: 'Nice to meet you.' },
      ],
    },
  });
  expect(made.status()).toBe(201);
  const exercise = (await made.json()) as { id: string };

  await openShadowing(page);
  await page.getByRole('button', { name: /^Two lines/ }).click();
  await expect(page.getByText('Предложение 1 из 2').first()).toBeVisible();

  // 1. Listen: the video plays this sentence only, then stops by itself.
  await page.getByRole('button', { name: 'Слушай' }).click();
  const turn = page.getByRole('button', { name: 'Твоя очередь' });
  await expect(turn).toBeVisible({ timeout: 5000 });
  const log = (await page.evaluate(() => (window as unknown as { __yt: { log: unknown[][] } }).__yt.log)) as [
    string,
    number,
  ][];
  expect(log.find(([what]) => what === 'seek')).toEqual(['seek', 1]);
  const paused = log.filter(([what]) => what === 'pause').at(-1)!;
  expect(paused[1]).toBeGreaterThanOrEqual(2);
  expect(paused[1]).toBeLessThan(2.3);

  // 2. Your turn: the microphone records, the video stays paused.
  await turn.click();
  const stop = page.getByRole('button', { name: 'Стоп' });
  await expect(stop).toBeVisible();
  await page.waitForTimeout(400);
  await stop.click();

  // 3. Compare: the original, my recording, then on.
  await expect(page.getByRole('button', { name: 'Оригинал' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Я', exact: true })).toBeVisible();
  // «Ещё раз» records again at once: no listening first, one press.
  const seeks = async () =>
    (
      (await page.evaluate(() => (window as unknown as { __yt: { log: unknown[][] } }).__yt.log)) as [string, number][]
    ).filter(([what]) => what === 'seek').length;
  const heard = await seeks();
  await page.getByRole('button', { name: 'Ещё раз' }).click();
  await expect(page.getByRole('button', { name: 'Стоп' })).toBeVisible();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Стоп' }).click();
  await expect(page.getByRole('button', { name: 'Оригинал' })).toBeVisible();
  expect(await seeks()).toBe(heard);
  await page.getByRole('button', { name: 'Дальше' }).click();
  await expect(page.getByText('Предложение 2 из 2').first()).toBeVisible();

  // The last sentence skipped straight to the end with «Готово» after one more turn.
  await page.getByRole('button', { name: 'Слушай' }).click();
  await page.getByRole('button', { name: 'Твоя очередь' }).click();
  await page.getByRole('button', { name: 'Стоп' }).click();
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByRole('heading', { name: 'Молодец!' })).toBeVisible();
  await expect(page.getByText('Предложений: 2')).toBeVisible();
  await expect
    .poll(async () => {
      const status = await page.request.get(`/api/shadowing/exercises/${exercise.id}/attempts`);
      return ((await status.json()) as { completed_count: number }).completed_count;
    })
    .toBe(1);
});

test('a video YouTube won’t show here is said plainly', async ({ page }) => {
  await fakeYouTube(page, {
    status: 404,
    body: { error: { code: 'video_unavailable', message: 'gone' } },
  });
  await openShadowing(page);
  await page.getByRole('button', { name: /Из YouTube/ }).click();
  await page.getByLabel('Ссылка из YouTube').fill('https://youtu.be/gonegonegon');
  await page.getByRole('button', { name: 'Проверить' }).click();
  await expect(page.getByRole('alert')).toContainText('Это видео нельзя показать здесь');
});

test('the group’s owner gives an exercise with «Дать группе»; a member opens it from the task', async ({
  page,
  context,
  browser,
}) => {
  await fakeYouTube(page, VIDEO_FOUND);
  const group = await (
    await (await named(context, 'Ольга')).request.post('/api/groups', { data: { name: '7Б' } })
  ).json();
  const exercise = await (
    await page.request.post('/api/shadowing/exercises', {
      data: {
        youtube_id: VIDEO,
        title: 'Food talk',
        difficulty: 'beginner',
        clip_start_ms: 1000,
        clip_end_ms: 3000,
        sentences: [
          { start_ms: 1000, end_ms: 2000, text: 'Hello there.' },
          { start_ms: 2000, end_ms: 3000, text: 'Nice to meet you.' },
        ],
      },
    })
  ).json();
  const id = `e2e-s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const masha = await browser.newContext({
    extraHTTPHeaders: { ...DEMO, 'X-Dev-User': id },
    viewport: { width: 390, height: 844 },
  });
  await masha.request.patch('/api/me', { data: { daily_target_words: 5, study_days_per_week: 6 } });
  await (await named(masha, 'Маша')).request.post(`/api/groups/join/${group.invite_code}`);

  // The owner, on the exercise: «Дать группе», every day.
  await openShadowing(page);
  await page.getByRole('button', { name: /^Food talk/ }).click();
  await page.getByRole('button', { name: 'Дать группе' }).click();
  const dialog = page.getByRole('dialog', { name: 'Дать группе «Food talk»' });
  await dialog.getByRole('radio', { name: 'Каждый день' }).check();
  await expect(dialog.getByRole('textbox', { name: 'Название' })).toHaveValue('Шэдоуинг: Food talk');
  await dialog.getByRole('button', { name: 'Дать', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Задание в «7Б»' })).toBeVisible();

  // The member: the task in «Планы», its material opens the exercise.
  const mashaPage = await masha.newPage();
  await fakeYouTube(mashaPage, VIDEO_FOUND);
  await mashaPage.goto('/');
  await mashaPage.getByRole('navigation').getByRole('button', { name: 'Планы' }).click();
  const row = mashaPage.getByRole('listitem').filter({ hasText: 'Шэдоуинг: Food talk' });
  await row.getByRole('button', { name: /Шэдоуинг: Food talk/ }).click();
  const view = mashaPage.getByRole('dialog');
  await expect(view).toContainText('Food talk');
  await view.getByRole('button', { name: 'Открыть' }).click();
  await expect(mashaPage.getByText('Предложение 1 из 2').first()).toBeVisible();
  // Not hers to give.
  await expect(mashaPage.getByRole('button', { name: 'Дать группе' })).toHaveCount(0);
  expect(exercise.id).toBeTruthy();
  await masha.close();
});
