import { type Page } from '@playwright/test';
import { button, expect, openDeck, study, test } from './learner.ts';

// Studying on the device (ADR 0062): lessons are planned, scheduled and checked here, with no
// request between cards; answers wait in the outbox and the server re-applies them. A production
// build: only it has the service worker, so the app itself opens without a connection.

const home = (page: Page) => page.getByRole('heading', { level: 1, name: 'Мои колоды' });

async function visitOnline(page: Page) {
  await page.goto('/');
  await expect(home(page)).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.waitForLoadState('networkidle');
}

interface Kept {
  lessons: {
    id: string;
    steps: { id: string; wordId: string }[];
    results: { exercise_id: string; next_due_at: string | null }[];
    finishedAt: number | null;
  }[];
  answers: { acked: boolean }[];
  outbox: { kind: string }[];
  pack: { progress: [string, number, number | null, number | null, number | null, string][] } | null;
}

/** What this device keeps for the learner, read straight from IndexedDB. */
function kept(page: Page): Promise<Kept> {
  return page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((info) => info.name ?? '');
    const name = names.find((candidate) => candidate.startsWith('slovar-') && candidate !== 'slovar-meta')!;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(name);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const all = (store: string) =>
      new Promise<unknown[]>((resolve, reject) => {
        const reading = db.transaction(store).objectStore(store).getAll();
        reading.onsuccess = () => resolve(reading.result);
        reading.onerror = () => reject(reading.error);
      });
    const [lessons, answers, outbox, records] = await Promise.all([
      all('lessons'),
      all('answers'),
      all('outbox'),
      all('study'),
    ]);
    db.close();
    const pack = (records as { key: string; pack?: unknown }[]).find((record) => record.key === 'pack')?.pack ?? null;
    return { lessons, answers, outbox, pack } as Kept;
  });
}

const reconnect = async (page: Page) => {
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
};

test('a lesson studied offline, reloaded midway, comes out on the server exactly as the device worked it out', async ({
  page,
  context,
}) => {
  await visitOnline(page);
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await expect(page.locator('[data-card]')).toBeVisible();

  await context.setOffline(true);
  await study(page, 'Снова'); // forgotten: it comes back later in the lesson
  await study(page, 'Трудно');
  // The app closes and opens again, still without a connection: the lesson is where it was.
  await page.reload();
  await openDeck(page);
  await button(page, 'Продолжить урок').click();
  // Known at once: due again on a later day, from 4 AM in the learner's own zone.
  await study(page, 'Легко');
  const summary = page.getByRole('button', { name: 'На главную' });
  while (!(await summary.isVisible())) await study(page, 'Хорошо');

  // The device's own reckoning: when each word comes back.
  const offline = await kept(page);
  const [lesson] = offline.lessons;
  expect(lesson.finishedAt).not.toBeNull();
  expect(lesson.steps.length).toBeGreaterThan(5); // the forgotten card was shown again
  const word = new Map(lesson.steps.map((step) => [step.id, step.wordId]));
  const predicted = new Map(lesson.results.map((result) => [word.get(result.exercise_id)!, result.next_due_at]));
  expect(predicted.size).toBe(5);
  expect(offline.outbox.filter((item) => item.kind === 'study.answer')).toHaveLength(lesson.steps.length);

  // Back online: sent, re-applied by the server, and its pack brought back.
  await reconnect(page);
  await expect
    .poll(async () => {
      const now = await kept(page);
      return now.outbox.length === 0 && now.answers.length === 0 ? (now.pack?.progress.length ?? 0) : -1;
    })
    .toBe(5);
  const { pack } = await kept(page);
  const server = new Map(pack!.progress.map((row) => [row[0], new Date(row[5]).toISOString()]));
  expect(server).toEqual(new Map([...predicted].map(([wordId, due]) => [wordId, new Date(due!).toISOString()])));
});

test("answers dated before the device's last contact are not counted, and home says so", async ({ page, context }) => {
  await visitOnline(page);
  await openDeck(page);
  await button(page, 'Начать урок · 5 слов').click();
  await expect(page.locator('[data-card]')).toBeVisible();

  // The phone's clock goes back three days while there is no connection.
  await context.setOffline(true);
  await page.evaluate(() => localStorage.setItem('server-clock-offset', String(-3 * 86_400_000)));
  await page.reload();
  await openDeck(page);
  await button(page, 'Продолжить урок').click();
  await study(page, 'Хорошо');

  await reconnect(page);
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText(
    'Не засчитано ответов: 1. На телефоне было неправильное время или ответы старше месяца.',
  );
});

test('recordings of the words ahead are kept, and play without a connection', async ({ page, context }) => {
  await visitOnline(page);
  // A sync with the worker in charge: the week's words, and the next new ones ("money" is the
  // sixth word of the first level, not yet met).
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(() =>
      page.evaluate(() =>
        caches
          .open('audio-1')
          .then((cache) => cache.match('/audio/words/money.mp3'))
          .then(Boolean),
      ),
    )
    .toBe(true);
  await context.setOffline(true);
  const status = await page.evaluate(() =>
    Promise.all(['/audio/words/money.mp3', '/audio/examples/money.mp3'].map((url) => fetch(url).then((r) => r.status))),
  );
  expect(status).toEqual([200, 200]);
});
