import type { Page } from '@playwright/test';
import { expect, test } from './learner.ts';

/**
 * The archive of spoken answers: every attempt across questions, newest first, its recording
 * playable on tap, its feedback one tap away, and progress at the top. The server's answers are
 * mocked (the endpoints are tested in the backend); the questions and navigation are real.
 */
test.use({ speaker: true, viewport: { width: 390, height: 844 } });

const id = (n: number) => `aaaaaaaa-aaaa-aaaa-aaaa-${String(n).padStart(12, '0')}`;
const scores = (overall: number | null, fluency: number | null) => ({
  overall_score: overall,
  pronunciation_score: overall,
  fluency_score: fluency,
  vocabulary_score: null,
  grammar_score: null,
  coherence_score: null,
});
// Newest first, as the server sends them.
const SESSIONS = [
  { n: 3, q: 'spon-hometown', day: 19, status: 'done', ...scores(78, 72) },
  { n: 2, q: 'spon-films', day: 18, status: 'done', ...scores(64, 60) },
  { n: 1, q: 'spon-hometown', day: 17, status: 'done', ...scores(52, 41) },
].map(({ n, q, day, status, ...s }) => ({
  id: id(n),
  question_id: q,
  exercise_type: 'spontaneous',
  status,
  started_at: `2026-11-${day}T10:00:00Z`,
  completed_at: `2026-11-${day}T10:02:00Z`,
  duration_ms: 95_000,
  has_audio: true,
  ...s,
}));

/** One second of silence as a WAV: something real for the player to load. */
function silence(): Buffer {
  const rate = 8000;
  const data = Buffer.alloc(rate * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

async function openArchive(page: Page) {
  const audioAsked: string[] = [];
  await page.route(
    (url) => url.pathname.endsWith('/api/speaking/sessions'),
    (route) => route.fulfill({ json: SESSIONS }),
  );
  await page.route('**/api/speaking/sessions/*/audio', (route) => {
    audioAsked.push(route.request().url());
    return route.fulfill({ body: silence(), contentType: 'audio/wav' });
  });
  await page.route(`**/api/speaking/sessions/${id(2)}`, (route) =>
    route.fulfill({
      json: {
        id: id(2),
        question_id: 'spon-films',
        exercise_type: 'spontaneous',
        status: 'done',
        failure_reason: null,
        started_at: '2026-11-18T10:00:00Z',
        completed_at: '2026-11-18T10:02:00Z',
        audio: { mime_type: 'audio/webm', byte_size: 1000, duration_ms: 95_000, sample_rate: null, uploaded_at: '' },
        assessment: null,
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Речь' }).click();
  await page.getByRole('button', { name: /Мои ответы/ }).click();
  await expect(page.getByRole('heading', { name: 'Мои ответы' })).toBeVisible();
  return audioAsked;
}

test('every answer is listed newest first, and nothing downloads until play', async ({ page }) => {
  const audioAsked = await openArchive(page);
  const rows = page.getByRole('list', { name: 'Мои ответы' }).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('78%');
  await expect(rows.nth(2)).toContainText('52%');
  await expect(rows.nth(0)).toContainText('1:35'); // the recording's length, before it loads
  expect(audioAsked).toHaveLength(0);

  await rows
    .nth(1)
    .getByRole('button', { name: /Послушать/ })
    .click();
  await expect(rows.nth(1).getByRole('slider', { name: 'Ваша запись' })).toBeVisible();
  expect(audioAsked).toEqual([expect.stringContaining(`/sessions/${id(2)}/audio`)]);
  // Nothing sideways on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('progress shows the overall line and each skill’s change since the first answers', async ({ page }) => {
  await openArchive(page);
  await expect(page.getByRole('img', { name: /3 ответам: первый 52%, последний 78%/ })).toBeVisible();
  // Fluency 41 → 72: the latest one compared with the first one (three answers, groups of one).
  const fluency = page.getByRole('listitem').filter({ hasText: 'Беглость' });
  await expect(fluency).toContainText('72%');
  await expect(fluency.getByLabel('выросло на 31')).toBeVisible();
});

test('an answer opens its feedback, which plays the recording too, and back returns here', async ({ page }) => {
  await openArchive(page);
  await page.getByRole('button', { name: /favourite film/ }).click();
  await expect(page.getByRole('heading', { name: 'Оценка' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Послушать: Ваша запись/ })).toBeVisible();
  await page.getByRole('button', { name: /Назад/ }).click();
  await expect(page.getByRole('heading', { name: 'Мои ответы' })).toBeVisible();
});
