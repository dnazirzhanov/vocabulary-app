import type { Page } from '@playwright/test';
import { DEMO, expect, named, test } from './learner.ts';

/**
 * Shadowing from a YouTube video (ADR 0097, 0098) for a learner who isn't a Speaking tester: it
 * is everyone's. YouTube isn't reached from tests: its player script is replaced by a stand-in with
 * the same API that keeps time by itself, and the server's looks at YouTube (oEmbed, the video's
 * captions) are answered here; the backend tests check those calls.
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

const NO_CAPTIONS = { status: 404, body: { error: { code: 'no_captions', message: 'No captions' } } };

async function fakeYouTube(
  page: Page,
  check: { status: number; body: unknown },
  transcript: { status: number; body: unknown } = NO_CAPTIONS,
) {
  await page.route('**/api/shadowing/youtube/transcript', (route) =>
    route.fulfill({
      status: transcript.status,
      contentType: 'application/json',
      body: JSON.stringify(transcript.body),
    }),
  );
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

  // The video has no captions of its own: the learner pastes the text.
  await expect(page.getByText('Текст видео сам не нашёлся.', { exact: false })).toBeVisible();
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

test('the video’s text is found by itself; the learner picks which ten minutes to learn', async ({ page }) => {
  // Half an hour of automatic captions, a sentence every 5 s.
  const cues = Array.from({ length: 360 }, (_, i) => ({
    start_ms: i * 5000,
    end_ms: i * 5000 + 5000,
    text: `This is sentence number ${i + 1}.`,
  }));
  await fakeYouTube(page, VIDEO_FOUND, { status: 200, body: { kind: 'auto', cues } });
  await openShadowing(page);
  await page.getByRole('button', { name: /Из YouTube/ }).click();
  await page.getByLabel('Ссылка из YouTube').fill(`https://www.youtube.com/watch?v=${VIDEO}`);
  await page.getByRole('button', { name: 'Проверить' }).click();

  // Nothing to paste: the text is there, said to be automatic, and the first minute is suggested.
  await expect(page.getByText('Текст из автоматических субтитров', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Текст со временем (0:00 …)')).toBeHidden();
  await expect(page.getByText('Предложений: 12 · 1:00')).toBeVisible();

  // From 12:00, ten minutes.
  await page.getByLabel('Начать с').selectOption('12');
  await page.getByLabel('Сколько учить').selectOption('10');
  await expect(page.getByText('Предложений: 120 · 10:00')).toBeVisible();
  const sentences = page.getByRole('list', { name: 'Предложения' }).getByRole('textbox');
  await expect(sentences.first()).toHaveValue('This is sentence number 145.');

  // Their own text can still be pasted instead.
  await page.getByRole('button', { name: 'Вставить свой текст' }).click();
  await expect(page.getByLabel('Текст со временем (0:00 …)')).toBeVisible();

  await page.getByRole('button', { name: 'Сохранить упражнение' }).click();
  await expect(page.getByText('Предложение 1 из 120').first()).toBeVisible();
  const made = (await (await page.request.get('/api/shadowing/exercises')).json()) as {
    mine: boolean;
    clip_start_ms: number;
    clip_end_ms: number;
    sentences: unknown[];
  }[];
  expect(made.filter((e) => e.mine)).toEqual([
    expect.objectContaining({ clip_start_ms: 720_000, clip_end_ms: 1_320_000 }),
  ]);
  expect(made.find((e) => e.mine)?.sentences).toHaveLength(120);
});

test('the channel’s lines are timed by the recognised words; the text can be shifted and a sentence split', async ({
  page,
}) => {
  // One subtitle line from 0 to 9 s, but its words are said from 2 s, 0.3 s apart.
  const said = 'hello there my friend how are you today'.split(' ');
  await fakeYouTube(page, VIDEO_FOUND, {
    status: 200,
    body: {
      kind: 'manual',
      cues: [{ start_ms: 0, end_ms: 9000, text: 'Hello there, my friend. How are you today?' }],
      words: said.map((text, i) => ({ start_ms: 2000 + i * 300, end_ms: 2250 + i * 300, text })),
    },
  });
  await openShadowing(page);
  await page.getByRole('button', { name: /Из YouTube/ }).click();
  await page.getByLabel('Ссылка из YouTube').fill(`https://youtu.be/${VIDEO}`);
  await page.getByRole('button', { name: 'Проверить' }).click();
  await expect(page.getByText('Текст взяли из субтитров автора')).toBeVisible();
  const ytLog = () => page.evaluate(() => (window as unknown as { __yt: { log: [string, number][] } }).__yt.log);
  const lastSeek = async () => (await ytLog()).filter(([what]) => what === 'seek').at(-1)?.[1];

  // ▶ plays from just before the first word is said (1.85 s), not from the line's 0 s.
  await page.getByRole('button', { name: 'Послушать предложение 1' }).click();
  await expect.poll(lastSeek).toBe(1.85);
  await page.getByRole('button', { name: 'Остановить' }).click();

  // The whole text 0.3 s later.
  const shift = page.getByRole('group', { name: 'Текст и звук' });
  for (let i = 0; i < 3; i += 1) await shift.getByRole('button', { name: 'Позже' }).click();
  await expect(shift.getByRole('status')).toHaveText('+0,3 с');
  await page.getByRole('button', { name: 'Послушать предложение 1' }).click();
  await expect.poll(lastSeek).toBe(2.15);
  await page.getByRole('button', { name: 'Остановить' }).click();

  // Split before «How».
  await page.getByRole('button', { name: 'Разделить' }).click();
  await page
    .getByRole('group', { name: 'Нажмите слово, с которого начнётся новое предложение' })
    .getByRole('button', { name: 'How' })
    .click();
  const sentences = page.getByRole('list', { name: 'Предложения' }).getByRole('textbox');
  await expect(sentences).toHaveCount(2);
  await expect(sentences.nth(0)).toHaveValue('Hello there, my friend.');
  await expect(sentences.nth(1)).toHaveValue('How are you today?');

  await page.getByRole('button', { name: 'Сохранить упражнение' }).click();
  await expect(page.getByText('Предложение 1 из 2').first()).toBeVisible();
  const made = (await (await page.request.get('/api/shadowing/exercises')).json()) as {
    mine: boolean;
    sentences: { start_ms: number; text: string }[];
  }[];
  const mine = made.find((e) => e.mine)!;
  expect(mine.sentences.map((s) => s.text)).toEqual(['Hello there, my friend.', 'How are you today?']);
  expect(mine.sentences[0].start_ms).toBe(2150);
});

test('when YouTube refuses for a moment, asking again brings the text', async ({ page }) => {
  // 27 Nov: YouTube told the server «confirm you're not a bot» for a while; a minute later it answered.
  await fakeYouTube(page, VIDEO_FOUND);
  let asks = 0;
  await page.route('**/api/shadowing/youtube/transcript', (route) => {
    asks += 1;
    return asks === 1
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'captions_refused', message: 'Not now' } }),
        })
      : route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ kind: 'manual', cues: [{ start_ms: 0, end_ms: 3000, text: 'Hello there.' }] }),
        });
  });
  await openShadowing(page);
  await page.getByRole('button', { name: /Из YouTube/ }).click();
  await page.getByLabel('Ссылка из YouTube').fill(`https://youtu.be/${VIDEO}`);
  await page.getByRole('button', { name: 'Проверить' }).click();

  // Told it may work again, with the paste box meanwhile.
  await expect(page.getByText('YouTube сейчас не дал текст.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Текст со временем (0:00 …)')).toBeVisible();
  await page.getByRole('button', { name: 'Попробовать ещё раз' }).click();
  await expect(page.getByText('Текст взяли из субтитров автора')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Предложения' }).getByRole('textbox')).toHaveValue('Hello there.');
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

  // A word of the sentence is tapped for its meaning, as in Reading (ADR 0099).
  await page.getByRole('button', { name: 'there', exact: true }).click();
  const card = page.getByRole('dialog', { name: 'there: перевод' });
  await expect(card).toContainText('перевод «there» (демо)');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);

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
  // Paused just before the sentence's end (its pause takes a moment to be heard), never after it.
  expect(paused[1]).toBeGreaterThanOrEqual(1.9);
  expect(paused[1]).toBeLessThan(2);

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

test('the card shows only this sentence; the speed goes − and + as on YouTube and is kept', async ({ page }) => {
  await fakeYouTube(page, VIDEO_FOUND);
  await page.request.post('/api/shadowing/exercises', {
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
  await openShadowing(page);
  await page.getByRole('button', { name: /^Two lines/ }).click();
  await expect(page.getByText('Предложение 1 из 2').first()).toBeVisible();
  // No dots to jump between sentences (‹ › do it), and not the next sentence's words.
  await expect(page.getByRole('list', { name: 'Предложения' })).toHaveCount(0);
  await expect(page.getByText('Nice to meet you.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Следующее предложение' })).toBeVisible();

  const speed = page.getByRole('group', { name: 'Скорость' });
  const now = speed.getByRole('button', { name: /^Скорость .*: выбрать$/ });
  await expect(now).toHaveText('1×');
  // + and − by a tenth.
  await speed.getByRole('button', { name: 'Быстрее' }).click();
  await expect(now).toHaveText('1,1×');
  await page.getByRole('button', { name: 'Слушай' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __yt: { log: unknown[][] } }).__yt.log))
    .toContainEqual(['rate', 1.1]);

  // Kept on this device for next time.
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Речь' }).click();
  await page.getByRole('button', { name: /^Two lines/ }).click();
  await expect(now).toHaveText('1,1×');
  for (let i = 0; i < 6; i += 1) await speed.getByRole('button', { name: 'Медленнее' }).click();
  await expect(now).toHaveText('0,5×');
  await expect(speed.getByRole('button', { name: 'Медленнее' })).toBeDisabled();

  // The usual speeds, from the speed itself, up to 2×.
  await now.click();
  await speed.getByRole('group', { name: 'Обычные скорости' }).getByRole('button', { name: '2×' }).click();
  await expect(now).toHaveText('2×');
  await expect(speed.getByRole('button', { name: 'Быстрее' })).toBeDisabled();
});

test('the speed changes at once while the sentence plays', async ({ page }) => {
  await fakeYouTube(page, VIDEO_FOUND);
  await page.request.post('/api/shadowing/exercises', {
    data: {
      youtube_id: VIDEO,
      title: 'Long one',
      difficulty: 'beginner',
      clip_start_ms: 1000,
      clip_end_ms: 9000,
      sentences: [{ start_ms: 1000, end_ms: 9000, text: 'A long sentence to change the speed in the middle of it.' }],
    },
  });
  await openShadowing(page);
  await page.getByRole('button', { name: /^Long one/ }).click();
  const speed = page.getByRole('group', { name: 'Скорость' });
  await speed.getByRole('button', { name: /: выбрать$/ }).click();
  await speed.getByRole('button', { name: '0,75×' }).click();
  await page.getByRole('button', { name: 'Слушай' }).click();
  const ytLog = () => page.evaluate(() => (window as unknown as { __yt: { log: [string, number][] } }).__yt.log);
  await expect.poll(async () => (await ytLog()).some(([what]) => what === 'play')).toBe(true);
  // Playing: 1.5× now, without stopping.
  await speed.getByRole('button', { name: /: выбрать$/ }).click();
  await speed.getByRole('button', { name: '1,5×' }).click();
  const log = await ytLog();
  const played = log.findIndex(([what]) => what === 'play');
  const faster = log.findIndex(([what, value], i) => i > played && what === 'rate' && value === 1.5);
  expect(faster).toBeGreaterThan(played);
  // No pause and no new seek between the start and the change: it played on.
  expect(log.slice(played, faster).some(([what]) => what === 'pause' || what === 'seek')).toBe(false);
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

test('an exercise goes to several groups at once', async ({ page, context }) => {
  await fakeYouTube(page, VIDEO_FOUND);
  const owner = await named(context, 'Ольга');
  for (const name of ['7Б', '8А']) await owner.request.post('/api/groups', { data: { name } });
  await page.request.post('/api/shadowing/exercises', {
    data: {
      youtube_id: VIDEO,
      title: 'Food talk',
      difficulty: 'beginner',
      clip_start_ms: 1000,
      clip_end_ms: 2000,
      sentences: [{ start_ms: 1000, end_ms: 2000, text: 'Hello there, my friend.' }],
    },
  });
  const made: string[] = [];
  page.on('request', (request) => {
    const found = /\/api\/groups\/([^/]+)\/tasks$/.exec(request.url());
    if (found && request.method() === 'POST') made.push(found[1]);
  });

  await openShadowing(page);
  await page.getByRole('button', { name: /^Food talk/ }).click();
  await page.getByRole('button', { name: 'Дать группе' }).click();
  const dialog = page.getByRole('dialog', { name: 'Дать группе «Food talk»' });
  // Nothing ticked while there is more than one group: both are ticked.
  await expect(dialog.getByRole('button', { name: 'Дать', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: '7Б' }).check();
  await dialog.getByRole('checkbox', { name: '8А' }).check();
  await dialog.getByRole('button', { name: 'Дать', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Задания в группах «7Б», «8А»' })).toBeVisible();
  expect(new Set(made).size).toBe(2);
});

// A phone that opened the link inside Telegram, with the microphone refused (the browser's own
// request is replaced by one that refuses at once, as such a browser does).
const TELEGRAM_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; SM-A515F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 Telegram-Android/10.6.2 (Samsung SM-A515F; Android 13; SDK 33; AVERAGE)';

test.describe('without the microphone', () => {
  for (const [where, agent, says, place] of [
    [
      'in Telegram’s built-in browser',
      TELEGRAM_ANDROID,
      'Откройте её в Chrome или Safari',
      'mic/sentences/in-app-telegram',
    ],
    ['in a real browser', undefined, 'Микрофон не разрешён.', 'mic/sentences'],
  ] as const) {
    test(`recording refused ${where}: the learner is told what to do, and it is reported`, async ({ browser }) => {
      const id = `e2e-mic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const context = await browser.newContext({
        extraHTTPHeaders: { ...DEMO, 'X-Dev-User': id },
        viewport: { width: 390, height: 844 },
        ...(agent ? { userAgent: agent } : {}),
      });
      await context.request.patch('/api/me', { data: { daily_target_words: 5, study_days_per_week: 6 } });
      await named(context, 'Аня');
      const page = await context.newPage();
      await fakeYouTube(page, VIDEO_FOUND);
      // Refused at once, as such a browser does.
      await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () =>
          Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      });
      const reports: string[] = [];
      page.on('request', (request) => {
        if (request.url().endsWith('/api/client-errors')) reports.push(String(request.postDataJSON()?.place));
      });
      await page.request.post('/api/shadowing/exercises', {
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
      await openShadowing(page);
      await page.getByRole('button', { name: /^Two lines/ }).click();
      await page.getByRole('button', { name: 'Слушай' }).click();
      await page.getByRole('button', { name: 'Твоя очередь' }).click();
      await expect(page.getByRole('alert')).toContainText(says);
      await expect.poll(() => reports).toContain(place);
      await context.close();
    });
  }
});
