import { expect, test, type Page, type Request, type Route } from '@playwright/test';

const SUPABASE = 'http://localhost:54321';

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const fakeToken = `${base64url({ alg: 'ES256', typ: 'JWT' })}.${base64url({ sub: 'user-1', role: 'authenticated' })}.sig`;

function sessionFor(email: string) {
  return {
    access_token: fakeToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'refresh-1',
    user: { id: 'user-1', aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {} },
  };
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

/**
 * Stands in for Supabase Auth: any email signs up, "right@example.com" signs in with any password, others are refused.
 * The learning API is the real one (in development mode, which ignores the token), as a fresh learner per test.
 */
async function mockSupabase(page: Page) {
  const apiRequests: Request[] = [];
  const learner = `auth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  await page.route(`${SUPABASE}/**`, async (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    const body = request.postDataJSON() as { email?: string } | null;
    const json = (status: number, payload: object) =>
      route.fulfill({ status, headers: cors, contentType: 'application/json', json: payload });
    if (url.pathname.endsWith('/signup')) return json(200, sessionFor(body?.email ?? ''));
    if (url.pathname.endsWith('/token')) {
      if (body?.email === 'right@example.com') return json(200, sessionFor(body.email));
      return json(400, { code: 'invalid_credentials', message: 'Invalid login credentials' });
    }
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204, headers: cors });
    return json(404, { message: 'not mocked' });
  });
  // Past the first-run screens (e2e/goal.spec.ts covers them).
  await page.request.patch('/api/me', { data: { daily_target_words: 5 }, headers: { 'x-dev-user': learner } });
  await page.route('**/api/**', async (route) => {
    apiRequests.push(route.request());
    await route.continue({ headers: { ...route.request().headers(), 'x-dev-user': learner } });
  });
  return apiRequests;
}

const fillForm = async (page: Page, email: string, password: string) => {
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Пароль').fill(password);
};

test('a signed-out visitor sees the sign-up form, not the lessons', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Создайте аккаунт' })).toBeFocused();
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toHaveCount(0);

  const submit = page.getByRole('button', { name: 'Создать аккаунт' });
  await expect(submit).toBeDisabled();
  await fillForm(page, 'new@example.com', 'short');
  await expect(submit).toBeDisabled();
  await page.getByLabel('Пароль').fill('long-enough-1');
  await expect(submit).toBeEnabled();
});

test('signing up opens the lessons and sends the token to the API', async ({ page }) => {
  const apiRequests = await mockSupabase(page);
  await page.goto('/');
  await fillForm(page, 'new@example.com', 'long-enough-1');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
  const withToken = apiRequests.filter((request) => request.headers()['authorization'] === `Bearer ${fakeToken}`);
  expect(withToken.length).toBeGreaterThan(0);
  // Signed-out screens never reach the API.
  expect(apiRequests.every((request) => request.headers()['authorization'])).toBe(true);
});

test('a wrong password is explained in Russian and can be retried', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'С возвращением' })).toBeFocused();

  await fillForm(page, 'wrong@example.com', 'whatever-123');
  await page.getByRole('button', { name: 'Войти', exact: true }).last().click();
  await expect(page.getByRole('alert')).toHaveText('Неверный e-mail или пароль.');

  await page.getByLabel('E-mail').fill('right@example.com');
  await page.getByRole('button', { name: 'Войти', exact: true }).last().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();
});

test('the session survives a reload, and signing out returns to the form', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');
  await fillForm(page, 'right@example.com', 'long-enough-1');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Мои колоды' })).toBeVisible();

  await page.getByRole('button', { name: 'Профиль' }).click(); // the account lives in «Профиль»
  await expect(page.getByText('right@example.com')).toBeVisible();
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByRole('heading', { name: 'Создайте аккаунт' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Создайте аккаунт' })).toBeVisible();
});

test('deleting progress asks first, then signs the learner out', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');
  await fillForm(page, 'right@example.com', 'long-enough-1');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await page.getByRole('button', { name: 'Профиль' }).click(); // the account lives in «Профиль»

  await page.getByRole('button', { name: 'Удалить мой прогресс' }).click();
  await expect(page.getByText('восстановить их будет нельзя')).toBeVisible();
  await page.getByRole('button', { name: 'Отмена' }).click();
  await expect(page.getByRole('button', { name: 'Удалить мой прогресс' })).toBeVisible();

  await page.getByRole('button', { name: 'Удалить мой прогресс' }).click();
  await page.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(page.getByRole('heading', { name: 'Создайте аккаунт' })).toBeVisible();
});
