import { type Page } from '@playwright/test';
import { expect, test } from './learner.ts';

// The app keeps itself and a few screens on the device (ADR 0060): after one visit online it opens
// without a connection, says so, and shows what it last saw. A production build: only it has the
// service worker.

const home = (page: Page) => page.getByRole('heading', { level: 1, name: 'Мои колоды' });

async function visitOnline(page: Page) {
  await page.goto('/');
  await expect(home(page)).toBeVisible();
  // The worker has kept the app, and this device has its copies of the screens.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => caches.keys().then((names) => names.some((name) => name.startsWith('shell-')))))
    .toBe(true);
  await page.waitForLoadState('networkidle');
}

test('after one visit the app opens without a connection and says so', async ({ page, context }) => {
  await context.request.post('/api/decks', { data: { title: 'Путешествия' } });
  await visitOnline(page);
  await expect(page.getByRole('status')).toHaveCount(0);

  await context.setOffline(true);
  await page.reload();
  await expect(home(page)).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Нет соединения. Показано то, что сохранено на этом устройстве.');
  // What it last saw: my deck and the course.
  await expect(page.getByRole('button', { name: /^Путешествия/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть курс' })).toBeVisible();

  // Back online, the next request clears the note.
  await context.setOffline(false);
  await page.reload();
  await expect(home(page)).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
});

test("this device keeps the account's screens under its own id, and no password or token", async ({
  page,
  context,
}) => {
  await visitOnline(page);
  // This device's store is the account's own, named by its id, and holds no password or token.
  const names = await page.evaluate(() => indexedDB.databases().then((all) => all.map((db) => db.name)));
  const me = (await (await context.request.get('/api/me')).json()) as { id: string };
  expect(names.sort()).toEqual(['slovar-meta', `slovar-${me.id}`].sort());
  const kept = await page.evaluate(
    (name) =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open(name);
        open.onsuccess = () => {
          const all = open.result.transaction('snapshots').objectStore('snapshots').getAll();
          all.onsuccess = () => resolve(JSON.stringify(all.result));
        };
      }),
    `slovar-${me.id}`,
  );
  expect(kept).not.toMatch(/access_token|refresh_token|password/i);
});
